import {
  canCollapse,
  canGoBack,
  canGoForward,
  clearNavigation,
  createChromeSession,
  enterPlugins,
  enterSettings as enterSettingsState,
  goBack,
  goForward,
  selectPluginsFocus,
  togglePin,
  usePlugin as usePluginState,
} from './chrome-state.js';

const LOCAL_USER_LABEL = '本地用户';

export function mountChrome({ settings, plugins, pluginsPage, shell, setStatus, applySplitWidth = () => {} }) {
  const backBtn = document.getElementById('history-back');
  const forwardBtn = document.getElementById('history-forward');
  const collapseBtn = document.getElementById('sidebar-toggle');
  const gearBtn = document.getElementById('rail-settings');
  const popover = document.getElementById('gear-popover');
  const usernameEl = document.getElementById('gear-username');
  const splitLayout = document.getElementById('split-layout');
  const settingsSlots = [
    'settings-heading',
    'settings-search',
    'settings-section',
    'settings-list',
    'settings-screen',
  ].map((id) => document.getElementById(id));
  const pluginsSlots = [
    'plugins-heading',
    'plugins-search-toggle',
    'plugins-market-entry',
    'plugins-section',
    'plugins-list',
    'plugins-screen',
  ].map((id) => document.getElementById(id));
  const titleName = document.getElementById('titlebar-plugin-name');
  const homeBtn = document.getElementById('rail-home');
  const pluginsBtn = document.getElementById('rail-plugins');
  const sidebar = document.getElementById('sidebar');
  const shortcutEl = document.getElementById('settings-shortcut');
  const usesCommand = document.documentElement.classList.contains('is-mac');
  shortcutEl.textContent = usesCommand ? '⌘,' : 'Ctrl+,';

  let session = createChromeSession();
  let popoverOpen = false;
  let closeTimer = 0;

  function floating() {
    return !session.pinned && session.surface === 'workspace';
  }

  function apply() {
    document.body.dataset.pin = session.pinned ? 'on' : 'off';
    document.body.dataset.surface = session.surface;
    const settingsOpen = session.surface === 'settings';
    const pluginsOpen = session.surface === 'plugins';
    const workspace = session.surface === 'workspace';
    splitLayout.hidden = workspace;
    for (const slot of settingsSlots) slot.hidden = !settingsOpen;
    for (const slot of pluginsSlots) slot.hidden = !pluginsOpen;
    if (!pluginsOpen) {
      document.getElementById('plugins-search').hidden = true;
      document.getElementById('plugins-search-toggle').setAttribute('aria-expanded', 'false');
    }
    if (!workspace) applySplitWidth();
    backBtn.disabled = !canGoBack(session);
    forwardBtn.disabled = !canGoForward(session);
    collapseBtn.hidden = !workspace;
    collapseBtn.disabled = !canCollapse(session);
    collapseBtn.setAttribute('aria-pressed', session.pinned ? 'false' : 'true');
    titleName.textContent = workspace ? workspacePluginName() : '';
    if (!floating()) {
      window.clearTimeout(closeTimer);
      sidebar.classList.remove('is-open');
    }
    if (!workspace) setPopover(false);
    pluginsPage.sync(session);
  }

  function workspacePluginName() {
    if (!shell.activeId) return '';
    const plugin = shell.plugins.find((item) => item.id === shell.activeId);
    return plugin ? plugin.displayName : '';
  }

  function openFloat() {
    if (!floating()) return;
    window.clearTimeout(closeTimer);
    sidebar.classList.add('is-open');
  }

  function scheduleClose() {
    if (!floating()) return;
    window.clearTimeout(closeTimer);
    // 指针从轨移到侧栏时会先触发离开，稍等再收，避免中途闪一下。
    closeTimer = window.setTimeout(() => sidebar.classList.remove('is-open'), 60);
  }

  function setPopover(open) {
    popoverOpen = open;
    popover.hidden = !open;
    gearBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) void refreshUsername();
  }

  async function refreshUsername() {
    try {
      const name = await window.dex.localUsername();
      const text = typeof name === 'string' ? name.trim() : '';
      usernameEl.textContent = text || LOCAL_USER_LABEL;
    } catch {
      usernameEl.textContent = LOCAL_USER_LABEL;
    }
  }

  async function openSettings(pluginId) {
    const next = enterSettingsState(session);
    if (next !== session) {
      session = next;
      apply();
    }
    try {
      await settings.enterSettings(pluginId);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '无法打开设置', 'error');
    }
  }

  async function onBack() {
    const from = session.surface;
    const next = goBack(session);
    if (next === session) return;
    if (from === 'settings' && !(await settings.confirmDiscard())) return;
    session = next;
    if (from === 'settings') settings.leaveSettings({ resume: session.surface === 'workspace' });
    if (from === 'plugins' && session.surface === 'workspace') plugins.resume(shell.activeId);
    if (from === 'workspace' && session.surface === 'plugins') plugins.suspend();
    apply();
  }

  async function openPlugins() {
    const from = session.surface;
    const next = enterPlugins(session);
    if (next !== session) {
      if (from === 'settings' && !(await settings.confirmDiscard())) return;
      session = next;
      if (from === 'settings') settings.leaveSettings({ resume: false });
      if (from === 'workspace') plugins.suspend();
      if (from !== 'plugins') pluginsPage.clearStatus();
    }
    apply();
    if (from !== 'plugins') void pluginsPage.refreshCatalog();
  }

  backBtn.addEventListener('click', () => {
    void onBack();
  });

  homeBtn.addEventListener('click', () => {
    if (session.surface === 'workspace') return;
    onBack();
  });

  pluginsBtn.addEventListener('click', () => {
    void openPlugins();
  });

  forwardBtn.addEventListener('click', () => {
    const next = goForward(session);
    if (next === session) return;
    session = next;
    if (session.surface === 'settings') {
      apply();
      void settings.enterSettings().catch((err) => {
        setStatus(err instanceof Error ? err.message : '无法打开设置', 'error');
      });
      return;
    }
    if (session.surface === 'plugins') plugins.suspend();
    apply();
  });

  collapseBtn.addEventListener('click', () => {
    const next = togglePin(session);
    if (next === session) return;
    session = next;
    apply();
  });

  homeBtn.addEventListener('pointerenter', openFloat);
  sidebar.addEventListener('pointerenter', openFloat);
  homeBtn.addEventListener('pointerleave', scheduleClose);
  sidebar.addEventListener('pointerleave', scheduleClose);

  gearBtn.addEventListener('click', () => {
    setPopover(!popoverOpen);
  });

  popover.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    setPopover(false);
    if (button.id === 'gear-open-settings') void openSettings();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popoverOpen) setPopover(false);
    if (event.key !== ',' || event.shiftKey || event.altKey) return;
    const modified = usesCommand ? event.metaKey : event.ctrlKey;
    if (!modified) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    event.preventDefault();
    setPopover(false);
    void openSettings();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!popoverOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (popover.contains(target) || gearBtn.contains(target)) return;
    setPopover(false);
  });

  apply();

  return {
    session() {
      return session;
    },
    refresh() {
      apply();
    },
    enterPlugins: openPlugins,
    focusPlugin(pluginId) {
      const next = selectPluginsFocus(session, pluginId);
      if (next === session) return;
      session = next;
      apply();
    },
    async usePlugin(pluginId) {
      const plugin = shell.plugins.find((item) => item.id === pluginId);
      if (!plugin) return;
      shell.activeId = pluginId;
      session = usePluginState(session, pluginId);
      apply();
      await plugins.openPlugin(plugin);
      apply();
    },
    clearNavigation() {
      const next = clearNavigation(session);
      if (next === session) return;
      session = next;
      apply();
    },
    openSettings,
  };
}
