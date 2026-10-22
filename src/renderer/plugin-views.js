import { selectEvictions } from './view-quota.js';

const ABORTED = -3;

function contentsId(webview) {
  if (typeof webview.getWebContentsId !== 'function') return null;
  try {
    const id = webview.getWebContentsId();
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

async function readAvailableBytes() {
  try {
    const result = await window.dex.availableMemory();
    if (!result || result.ok !== true || typeof result.bytes !== 'number') return null;
    if (!Number.isFinite(result.bytes) || result.bytes < 0) return null;
    return result.bytes;
  } catch {
    return null;
  }
}

function parked(webview) {
  return webview.classList.contains('is-parked');
}

export function mountPluginViews({ viewportHost, onReopened, onLoaded, onFailed }) {
  const views = new Map();
  const evicted = new Set();
  let quotaSeq = 0;

  function residents() {
    return [...views.values()].map((entry) => ({ id: entry.id, lastHotAt: entry.lastHotAt }));
  }

  async function applyThrottle(entry) {
    const id = contentsId(entry.webview);
    if (id == null) return;
    // 先去掉隐藏再取消节流，先藏起再打开节流。不换父节点，否则 Electron 会拆掉访客页并重新加载。
    const throttle = parked(entry.webview);
    try {
      await window.dex.setViewThrottling(id, throttle);
    } catch {
      // 附着前读不到 guest。默认仍是「隐藏时节流」，热界面在显示后会再试一次。
    }
  }

  function drop(id, reason) {
    const entry = views.get(id);
    if (reason === 'evict') evicted.add(id);
    else if (reason === 'force' || (reason === 'fail' && !entry?.reopen)) evicted.delete(id);
    if (!entry) return;
    entry.closing = true;
    entry.webview.remove();
    views.delete(id);
  }

  function parkHot() {
    const now = Date.now();
    let parkedId = null;
    for (const entry of views.values()) {
      if (parked(entry.webview)) continue;
      entry.lastHotAt = now;
      entry.state = entry.loaded ? 'warm' : 'loading';
      entry.webview.classList.add('is-parked');
      void applyThrottle(entry);
      parkedId = entry.id;
    }
    return parkedId;
  }

  function present(id) {
    const entry = views.get(id);
    if (!entry) return false;
    entry.webview.classList.remove('is-parked');
    // 未就绪时藏起 guest，否则 Electron webview 会盖住 Lottie 遮罩。
    entry.webview.classList.toggle('is-booting', !entry.loaded);
    entry.state = entry.loaded ? 'hot' : 'loading';
    entry.lastHotAt = Date.now();
    void applyThrottle(entry);
    return true;
  }

  function mount(plugin, prepared) {
    if (views.has(plugin.id)) drop(plugin.id, 'force');
    const reopen = evicted.has(plugin.id);
    const webview = document.createElement('webview');
    webview.setAttribute('partition', prepared.partition);
    webview.setAttribute('preload', prepared.preloadUrl);
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');
    webview.setAttribute('src', plugin.uiUrl);
    webview.classList.add('is-booting');
    const entry = {
      id: plugin.id,
      webview,
      state: 'loading',
      loaded: false,
      lastHotAt: Date.now(),
      closing: false,
      reopen,
    };
    views.set(plugin.id, entry);

    const syncThrottle = () => {
      if (entry.closing || views.get(entry.id) !== entry) return;
      void applyThrottle(entry);
    };
    webview.addEventListener('did-attach', syncThrottle);
    webview.addEventListener('did-start-loading', syncThrottle);
    webview.addEventListener('did-finish-load', () => {
      if (entry.closing || views.get(entry.id) !== entry) return;
      const first = !entry.loaded;
      entry.loaded = true;
      entry.webview.classList.remove('is-booting');
      entry.state = parked(entry.webview) ? 'warm' : 'hot';
      syncThrottle();
      onLoaded(entry.id);
      if (first && entry.reopen) {
        entry.reopen = false;
        evicted.delete(entry.id);
        onReopened();
      }
    });
    webview.addEventListener('did-fail-load', (raw) => {
      const event = /** @type {ElectronDidFailLoadEvent} */ (raw);
      if (entry.closing || views.get(entry.id) !== entry) return;
      if (event.isMainFrame === false) return;
      if (event.errorCode === ABORTED) return;
      drop(entry.id, 'fail');
      const message = typeof event.errorDescription === 'string' && event.errorDescription
        ? event.errorDescription
        : '打开插件失败';
      onFailed(entry.id, message);
    });

    viewportHost.appendChild(webview);
    return entry;
  }

  async function enforceQuota(protectedId) {
    const seq = ++quotaSeq;
    const availableBytes = await readAvailableBytes();
    if (seq !== quotaSeq) return;
    const dropIds = selectEvictions({
      residents: residents(),
      protectedId,
      availableBytes,
    });
    if (seq !== quotaSeq) return;
    for (const id of dropIds) drop(id, 'evict');
  }

  return {
    has(id) {
      return views.has(id);
    },
    isShowing(id) {
      const entry = views.get(id);
      return !!entry && !parked(entry.webview);
    },
    isLoaded(id) {
      return !!views.get(id)?.loaded;
    },
    ids() {
      return [...views.keys()];
    },
    parkHot,
    present,
    mount,
    drop,
    enforceQuota,
  };
}
