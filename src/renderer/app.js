import { mountSidebar } from './sidebar.js';
import { mountPlugins } from './plugins.js';
import { mountPluginsPage } from './plugins-page.js';
import { mountUpdater } from './updater.js';
import { mountSettings } from './settings.js';
import { mountChrome } from './chrome.js';
import { mountIcons } from './icons.js';

const shell = {
  plugins: [],
  activeId: null,
  settingsMode: false,
};

const statusEl = document.getElementById('status');

function setStatus(message, kind) {
  statusEl.textContent = message || '';
  if (kind) statusEl.dataset.kind = kind;
  else delete statusEl.dataset.kind;
}

mountIcons();
const sidebar = mountSidebar();

// 插件列表刷新时可能正停在设置里，设置返回时又要回到刚才的插件。
// 两边的挂载函数互相还拿不到对方，所以先放桥，挂载完再接上。
const settingsBridge = {
  async onPluginsChanged() {},
  dismissSurface() {},
};

const chromeBridge = {
  session() {
    return null;
  },
  refresh() {},
  enterPlugins() {},
  focusPlugin() {},
  async usePlugin() {},
  clearNavigation() {},
  async openSettings() {},
};

const pluginsPageBridge = {
  sync() {},
  clearStatus() {},
};

const plugins = mountPlugins({
  shell,
  setStatus,
  settings: settingsBridge,
  onClearNavigation() { chromeBridge.clearNavigation(); },
  onOpenPluginSettings(pluginId) { void chromeBridge.openSettings(pluginId); },
  onWorkspaceChanged() { chromeBridge.refresh(); },
  onListChanged() {
    const session = chromeBridge.session();
    if (session) pluginsPageBridge.sync(session);
  },
});
const pluginsPage = mountPluginsPage({ shell, plugins, chrome: chromeBridge });
pluginsPageBridge.sync = pluginsPage.sync;
pluginsPageBridge.clearStatus = pluginsPage.clearStatus;

const settings = mountSettings({ shell, setStatus, plugins });
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

mountUpdater({ setStatus });

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
