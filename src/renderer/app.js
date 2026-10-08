const nav = document.getElementById('plugin-nav');
const welcome = document.getElementById('welcome-screen');
const headless = document.getElementById('headless-screen');
const viewportHost = document.getElementById('viewport-host');
const toolbar = document.getElementById('plugin-toolbar');
const statusEl = document.getElementById('status');
const dropZone = document.getElementById('drop-zone');
const installBtn = document.getElementById('install-btn');
const uninstallBtn = document.getElementById('uninstall-btn');
const uninstallHeadless = document.getElementById('uninstall-headless');
const pluginTitle = document.getElementById('plugin-title');
const headlessTitle = document.getElementById('headless-title');
const updateFooter = document.getElementById('update-footer');
const updateBtn = document.getElementById('update-btn');
const updateRetry = document.getElementById('update-retry');
const updateDialog = document.getElementById('update-dialog');
const updateDialogTitle = document.getElementById('update-dialog-title');
const updateDialogBody = document.getElementById('update-dialog-body');
const updateLater = document.getElementById('update-later');
const updateConfirm = document.getElementById('update-confirm');
const sidebar = document.getElementById('sidebar');
const splitter = document.getElementById('splitter');

const SIDEBAR_KEY = 'dex.sidebarWidth';
const SIDEBAR_DEFAULT = 292;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;

function clampSidebar(width) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

function applySidebarWidth(width) {
  const next = clampSidebar(width);
  document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
  splitter.setAttribute('aria-valuenow', String(next));
  return next;
}

function readSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw == null || raw === '') return SIDEBAR_DEFAULT;
    const width = Number(raw);
    if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
    return clampSidebar(width);
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function storeSidebarWidth(width) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(width));
  } catch {
    // 隐私模式写不进去时，这次会话里的宽度仍然有效。
  }
}

if (/Mac/i.test(navigator.platform)) document.body.classList.add('is-mac');
applySidebarWidth(readSidebarWidth());

splitter.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  try { splitter.setPointerCapture(event.pointerId); } catch { /* 指针尚未激活时忽略 */ }
  document.body.classList.add('is-resizing');
  const startX = event.clientX;
  const startWidth = sidebar.getBoundingClientRect().width;

  function move(ev) {
    applySidebarWidth(startWidth + (ev.clientX - startX));
  }

  function up(ev) {
    try { splitter.releasePointerCapture(ev.pointerId); } catch { /* 捕获已结束 */ }
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
    splitter.removeEventListener('pointercancel', up);
    document.body.classList.remove('is-resizing');
    storeSidebarWidth(applySidebarWidth(startWidth + (ev.clientX - startX)));
  }

  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
  splitter.addEventListener('pointercancel', up);
});

splitter.addEventListener('dblclick', () => {
  storeSidebarWidth(applySidebarWidth(SIDEBAR_DEFAULT));
});

splitter.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const current = sidebar.getBoundingClientRect().width;
  const delta = event.key === 'ArrowRight' ? 16 : -16;
  storeSidebarWidth(applySidebarWidth(current + delta));
});

let plugins = [];
let activeId = null;
let updateState = null;
let updaterOwnsStatus = false;

function setStatus(message, kind) {
  statusEl.textContent = message || '';
  if (kind) statusEl.dataset.kind = kind;
  else delete statusEl.dataset.kind;
}

function sourceLabel(source) {
  if (source === 'installed') return '已安装';
  if (source === 'dev') return '开发';
  return '内置';
}

function renderNav() {
  nav.replaceChildren();
  if (plugins.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-nav';
    empty.textContent = '还没有可用插件';
    nav.appendChild(empty);
    return;
  }

  for (const plugin of plugins) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    if (plugin.id === activeId) button.classList.add('active');
    button.setAttribute('aria-current', plugin.id === activeId ? 'true' : 'false');

    const top = document.createElement('div');
    top.className = 'nav-topline';
    const title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = plugin.displayName;
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = plugin.type === 'ui' ? '界面' : '后台';
    top.append(title, pill);

    const meta = document.createElement('span');
    meta.className = 'nav-meta';
    meta.textContent = `${plugin.version} · ${sourceLabel(plugin.source)}`;

    button.append(top, meta);
    button.addEventListener('click', () => {
      void openPlugin(plugin);
    });
    nav.appendChild(button);
  }
}

function showWelcome() {
  activeId = null;
  welcome.hidden = false;
  headless.hidden = true;
  toolbar.hidden = true;
  viewportHost.hidden = true;
  viewportHost.replaceChildren();
  renderNav();
}

async function openPlugin(plugin) {
  activeId = plugin.id;
  setStatus('');
  renderNav();

  try {
    if (plugin.type === 'ui' && plugin.uiUrl) {
      const prepared = await window.dex.preparePlugin(plugin.id);
      welcome.hidden = true;
      headless.hidden = true;
      toolbar.hidden = false;
      viewportHost.hidden = false;
      pluginTitle.textContent = plugin.displayName;
      uninstallBtn.hidden = plugin.source !== 'installed';
      viewportHost.replaceChildren();
      const webview = document.createElement('webview');
      webview.setAttribute('partition', prepared.partition);
      webview.setAttribute('preload', prepared.preloadUrl);
      webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');
      webview.setAttribute('src', plugin.uiUrl);
      viewportHost.appendChild(webview);
      return;
    }

    welcome.hidden = true;
    toolbar.hidden = true;
    viewportHost.hidden = true;
    viewportHost.replaceChildren();
    headless.hidden = false;
    headlessTitle.textContent = plugin.displayName;
    uninstallHeadless.hidden = plugin.source !== 'installed';
  } catch (err) {
    showWelcome();
    setStatus(err instanceof Error ? err.message : '打开插件失败', 'error');
  }
}

async function refresh(nextPlugins) {
  plugins = nextPlugins || (await window.dex.listPlugins());
  if (activeId && !plugins.some((plugin) => plugin.id === activeId)) {
    showWelcome();
    return;
  }
  renderNav();
}

async function installFromPath(zipPath) {
  if (!zipPath || !zipPath.toLowerCase().endsWith('.zip')) {
    setStatus('请拖入 .zip 插件包', 'error');
    return;
  }
  setStatus('正在安装…');
  const result = await window.dex.installZip(zipPath);
  if (!result.ok) {
    setStatus(result.message || '安装失败', 'error');
    return;
  }
  setStatus('插件已安装', 'ok');
  await refresh(result.plugins);
}

async function uninstallActive() {
  if (!activeId) return;
  const result = await window.dex.uninstall(activeId);
  if (!result.ok) {
    setStatus(result.message || '卸载失败', 'error');
    await refresh(result.plugins);
    return;
  }
  setStatus('插件已卸载', 'ok');
  showWelcome();
  await refresh(result.plugins);
}

installBtn.addEventListener('click', async () => {
  const result = await window.dex.pickAndInstall();
  if (result.cancelled) return;
  if (!result.ok) {
    setStatus(result.message || '安装失败', 'error');
    await refresh(result.plugins);
    return;
  }
  setStatus('插件已安装', 'ok');
  await refresh(result.plugins);
});

uninstallBtn.addEventListener('click', () => {
  void uninstallActive();
});
uninstallHeadless.addEventListener('click', () => {
  void uninstallActive();
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  const zipPath = window.dex.pathForFile(file);
  void installFromPath(zipPath);
});

function versionLabel(version) {
  return version ? `v${version}` : '新版本';
}

function isMacUpdate(payload) {
  return payload && payload.platformFlow === 'mac-dmg';
}

function fillUpdateDialog(payload) {
  const version = versionLabel(payload.availableVersion);
  const downloading = payload.status === 'downloading';
  const opening = payload.status === 'installing';
  if (isMacUpdate(payload)) {
    updateDialogTitle.textContent = '下载新版本？';
    updateDialogBody.textContent = downloading
      ? `正在下载 ${version} 的安装包，完成后会自动打开。`
      : opening
        ? `正在打开 ${version} 的安装包。请将应用拖入「应用程序」完成更新。`
        : `将下载 ${version} 的安装包（dmg），完成后会自动打开，需手动将应用拖入「应用程序」完成更新。`;
    updateConfirm.textContent = downloading || opening ? '请稍候' : '下载新版本';
  } else {
    updateDialogTitle.textContent = '安装更新并重启？';
    updateDialogBody.textContent = `将关闭应用并安装 ${version}。`;
    updateConfirm.textContent = '立即重启并更新';
  }
  updateConfirm.disabled = downloading || opening;
}

function renderUpdate(payload) {
  if (!payload) return;
  const previous = updateState;
  updateState = payload;
  const ready = payload.status === 'readyToInstall';
  const failed = payload.status === 'error';
  updateBtn.hidden = !ready;
  updateRetry.hidden = !failed;
  updateFooter.hidden = !ready && !failed;

  if (ready) {
    const version = versionLabel(payload.availableVersion);
    updateBtn.title = isMacUpdate(payload)
      ? `发现新版本 ${version}，点击下载`
      : `新版本 ${version} 已就绪`;
    updateBtn.setAttribute('aria-label', isMacUpdate(payload) ? '下载新版本' : '重启并安装更新');
  }

  if (failed && payload.errorMessage) {
    setStatus(payload.errorMessage, 'error');
    updaterOwnsStatus = true;
  } else if (payload.status === 'downloading' && isMacUpdate(payload)) {
    setStatus('正在下载新版本…');
    updaterOwnsStatus = true;
  } else if (updaterOwnsStatus) {
    setStatus('');
    updaterOwnsStatus = false;
  }

  if (updateDialog.open && (failed || (previous && previous.status === 'installing' && ready))) {
    updateDialog.close();
    return;
  }
  if (updateDialog.open) fillUpdateDialog(payload);
}

updateBtn.addEventListener('click', () => {
  if (!updateState || updateState.status !== 'readyToInstall') return;
  fillUpdateDialog(updateState);
  updateDialog.showModal();
});

updateLater.addEventListener('click', () => {
  updateDialog.close();
});

updateConfirm.addEventListener('click', async () => {
  if (!updateState || updateConfirm.disabled) return;
  updateConfirm.disabled = true;
  try {
    const result = await window.dex.installUpdate();
    if (result && result.blockedByTask) {
      setStatus('请先结束当前任务，再安装更新', 'error');
      updaterOwnsStatus = true;
      updateDialog.close();
      return;
    }
    if (isMacUpdate(updateState)) return;
    updateDialog.close();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : '安装更新失败', 'error');
    updaterOwnsStatus = true;
    updateDialog.close();
  }
});

updateRetry.addEventListener('click', () => {
  void window.dex.retryUpdateCheck();
});

window.dex.onUpdateStatus(renderUpdate);
void window.dex.getUpdateStatus().then(renderUpdate).catch(() => {});

void refresh().catch((err) => {
  setStatus(err instanceof Error ? err.message : '无法读取插件列表', 'error');
});
