import { mountSidebar } from './sidebar.js';
import { mountPlugins } from './plugins.js';
import { mountPluginsPage } from './plugins-page.js';
import { mountUpdater } from './updater.js';
import { mountSettings } from './settings.js';
import { mountChrome } from './chrome.js';
import { mountIcons } from './icons.js';
import { mountShellToast } from './shell-toast.js';
import { mountSpendGate } from './spend-gate.js';
import { byId } from './dom.js';

/** @type {{ plugins: PluginSummary[]; activeId: string | null; settingsMode: boolean }} */
const shell = {
  plugins: [],
  activeId: null,
  settingsMode: false,
};

const statusEl = byId('status', 'p');

/**
 * @param {string} message
 * @param {string} [kind]
 */
function setStatus(message, kind) {
  statusEl.textContent = message || '';
  if (kind) statusEl.dataset.kind = kind;
  else delete statusEl.dataset.kind;
}

mountIcons();
mountShellToast();

// 插件列表刷新时可能正停在设置里，设置返回时又要回到刚才的插件。
// 两边的挂载函数互相还拿不到对方，所以先放桥，挂载完再接上。
const settingsBridge = {
  async onPluginsChanged() {},
  dismissSurface() {},
};

const spendGateBridge = {
  onOpen() {},
  onClose() {},
};

mountSpendGate({
  pluginName(pluginId) {
    const plugin = shell.plugins.find((item) => item.id === pluginId || item.manifestId === pluginId);
    return plugin ? plugin.displayName : null;
  },
  onOpen() { spendGateBridge.onOpen(); },
  onClose() { spendGateBridge.onClose(); },
});
const sidebar = mountSidebar();

/** @type {ChromeBridge} */
const chromeBridge = {
  session() {
    return null;
  },
  refresh() {},
  enterPlugins() {},
  focusPlugin(_pluginId) {},
  async usePlugin(_pluginId) {},
  clearNavigation() {},
  async openSettings(_pluginId) {},
};

/** @type {{ sync: (session: ChromeSession) => void; clearStatus: () => void }} */
const pluginsPageBridge = {
  sync(_session) {},
  clearStatus() {},
};

const plugins = mountPlugins({
  shell,
  setStatus,
  settings: settingsBridge,
  onClearNavigation() { chromeBridge.clearNavigation(); },
  onOpenPluginSettings(pluginId) { void chromeBridge.openSettings(pluginId); },
  onOpenMarket() { chromeBridge.enterPlugins(); },
  onWorkspaceChanged() { chromeBridge.refresh(); },
  onListChanged() {
    const session = chromeBridge.session();
    if (session) pluginsPageBridge.sync(session);
  },
  onUnavailable(pluginId) {
    void (async () => {
      await chromeBridge.enterPlugins();
      chromeBridge.focusPlugin(pluginId);
    })();
  },
});

/** @type {string | null} */
let parkedForSpendGate = null;
spendGateBridge.onOpen = () => {
  parkedForSpendGate = plugins.parkHot();
};
spendGateBridge.onClose = () => {
  const id = parkedForSpendGate;
  parkedForSpendGate = null;
  if (id) plugins.present(id);
};

const pluginsPage = mountPluginsPage({ shell, plugins, chrome: chromeBridge });
pluginsPageBridge.sync = pluginsPage.sync;
pluginsPageBridge.clearStatus = pluginsPage.clearStatus;

/** @type {UpdaterBridge} */
const updaterBridge = {
  status() {
    return null;
  },
  onStatus(_callback) {
    return () => {};
  },
  openInstallDialog() {},
};

const settings = mountSettings({ shell, setStatus, plugins, updater: updaterBridge });
settingsBridge.onPluginsChanged = settings.onPluginsChanged;
settingsBridge.dismissSurface = settings.dismissSurface;

const chrome = mountChrome({
  settings,
  plugins,
  pluginsPage,
  shell,
  setStatus,
  applySplitWidth: sidebar.applySplitWidth,
});
Object.assign(chromeBridge, chrome);

Object.assign(updaterBridge, mountUpdater({ setStatus }));

function dismissBoot() {
  const boot = document.getElementById('boot');
  if (!boot || boot.hidden) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    boot.hidden = true;
    return;
  }
  boot.classList.add('is-leaving');
  const done = () => {
    boot.hidden = true;
  };
  boot.addEventListener('transitionend', done, { once: true });
  // 过渡被系统打断时 transitionend 不会来，遮罩不能一直盖住工作台。
  window.setTimeout(done, 220);
}

try {
  await plugins.refresh();
} catch (err) {
  setStatus(err instanceof Error ? err.message : '无法读取插件列表', 'error');
} finally {
  dismissBoot();
}
