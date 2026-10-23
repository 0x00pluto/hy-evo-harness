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
import { accountHeadline, isLoginPending, renderAccountPanel } from './account-session.js';
import { byId } from './dom.js';

/** @returns {GatewaySessionView} */
function emptySessionView() {
  return {
    signedIn: false,
    phoneMasked: null,
    balance: null,
    currency: null,
    login: { phase: 'idle' },
  };
}

/**
 * @param {{
 *   settings: {
 *     enterSettings: (pluginId?: string) => Promise<void>;
 *     confirmDiscard: () => Promise<boolean>;
 *     leaveSettings: (opts: { resume: boolean }) => void;
 *   };
 *   plugins: {
 *     syncPreviewStrip: () => void;
 *     resume: (pluginId?: string | null) => void;
 *     suspend: () => void;
 *     reloadActive: () => Promise<void> | void;
 *     openPlugin: (plugin: PluginSummary) => Promise<void>;
 *   };
 *   pluginsPage: {
 *     sync: (session: ChromeSession) => void;
 *     clearStatus: () => void;
 *     refreshCatalog: () => Promise<void> | void;
 *   };
 *   shell: { plugins: PluginSummary[]; activeId: string | null; settingsMode: boolean };
 *   setStatus: (message: string, kind?: string) => void;
 *   applySplitWidth?: () => void;
 * }} opts
 */
export function mountChrome({ settings, plugins, pluginsPage, shell, setStatus, applySplitWidth = () => {} }) {
  const backBtn = byId('history-back', 'button');
  const forwardBtn = byId('history-forward', 'button');
  const reloadBtn = byId('history-reload', 'button');
  const collapseBtn = byId('sidebar-toggle', 'button');
  const gearBtn = byId('rail-settings', 'button');
  const popover = byId('gear-popover', 'div');
  const usernameEl = byId('gear-username', 'div');
  const splitLayout = byId('split-layout', 'div');
  const settingsSlots = [
    byId('settings-heading', 'h2'),
    byId('settings-search', 'input'),
    byId('settings-section', 'div'),
    byId('settings-list', 'div'),
    byId('settings-screen', 'section'),
  ];
  const pluginsSlots = [
    byId('plugins-heading', 'h2'),
    byId('plugins-search-toggle', 'button'),
    byId('plugins-market-entry', 'button'),
    byId('plugins-section', 'div'),
    byId('plugins-list', 'div'),
    byId('plugins-screen', 'section'),
  ];
  const titleName = byId('titlebar-plugin-name', 'div');
  const homeBtn = byId('rail-home', 'button');
  const pluginsBtn = byId('rail-plugins', 'button');
  const accountBtn = byId('rail-account', 'button');
  const accountPopover = byId('account-popover', 'div');
  const sidebar = byId('sidebar', 'aside');
  const shortcutEl = byId('settings-shortcut', 'span');
  const pluginsSearch = byId('plugins-search', 'input');
  const pluginsSearchToggle = byId('plugins-search-toggle', 'button');
  const usesCommand = document.documentElement.classList.contains('is-mac');
  shortcutEl.textContent = usesCommand ? '⌘,' : 'Ctrl+,';

  let session = createChromeSession();
  let popoverOpen = false;
  let accountOpen = false;
  let closeTimer = 0;
  /** @type {string | null | undefined} */
  let reportedWatching;
  /** @type {GatewaySessionView} */
  let gatewayView = emptySessionView();

  function reportWatching() {
    const watching = session.surface === 'workspace' && shell.activeId ? shell.activeId : null;
    if (watching === reportedWatching) return;
    reportedWatching = watching;
    if (!window.dex.setWatchingPlugin) return;
    window.dex.setWatchingPlugin(watching);
  }

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
      pluginsSearch.hidden = true;
      pluginsSearchToggle.setAttribute('aria-expanded', 'false');
    }
    if (!workspace) applySplitWidth();
    backBtn.disabled = !canGoBack(session);
    forwardBtn.disabled = !canGoForward(session);
    reloadBtn.hidden = !showingUiPlugin();
    collapseBtn.hidden = !workspace;
    collapseBtn.disabled = !canCollapse(session);
    collapseBtn.setAttribute('aria-pressed', session.pinned ? 'false' : 'true');
    homeBtn.setAttribute('aria-current', workspace ? 'page' : 'false');
    pluginsBtn.setAttribute('aria-current', pluginsOpen ? 'page' : 'false');
    titleName.textContent = workspace ? workspacePluginName() : '';
    if (!floating()) {
      window.clearTimeout(closeTimer);
      sidebar.classList.remove('is-open');
    }
    if (!workspace) {
      setPopover(false);
      setAccountOpen(false);
    }
    plugins.syncPreviewStrip();
    pluginsPage.sync(session);
    reportWatching();
  }

  function workspacePluginName() {
    if (!shell.activeId) return '';
    /** @type {PluginSummary | undefined} */
    const plugin = shell.plugins.find((/** @type {PluginSummary} */ item) => item.id === shell.activeId);
    return plugin ? plugin.displayName : '';
  }

  function showingUiPlugin() {
    if (session.surface !== 'workspace' || !shell.activeId) return false;
    /** @type {PluginSummary | undefined} */
    const plugin = shell.plugins.find((/** @type {PluginSummary} */ item) => item.id === shell.activeId);
    return Boolean(plugin && plugin.type === 'ui' && plugin.uiUrl);
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

  /** @param {boolean} open */
  function setPopover(open) {
    popoverOpen = open;
    popover.hidden = !open;
    gearBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      setAccountOpen(false);
      paintGearAccount();
    }
  }

  /** @param {boolean} open */
  function setAccountOpen(open) {
    accountOpen = open;
    accountPopover.hidden = !open;
    accountBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      setPopover(false);
      paintAccountPopover();
    }
  }

  function paintGearAccount() {
    usernameEl.textContent = accountHeadline(gatewayView);
    const clickable = !gatewayView.signedIn;
    usernameEl.classList.toggle('is-clickable', clickable);
    usernameEl.setAttribute('role', clickable ? 'button' : 'presentation');
    usernameEl.tabIndex = clickable ? 0 : -1;
  }

  function paintAccountPopover() {
    renderAccountPanel(accountPopover, {
      view: gatewayView,
      onLogout: () => {
        void runGateway(() => window.dex.logoutGateway());
        setAccountOpen(false);
      },
      onContinue: () => {
        void runGateway(() => window.dex.reopenGatewayLogin());
        setAccountOpen(false);
      },
    });
  }

  /**
   * @param {() => Promise<{ ok: boolean; message?: string }>} action
   */
  async function runGateway(action) {
    try {
      const result = await action();
      if (result && result.ok === false && result.message) setStatus(result.message, 'error');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '操作失败', 'error');
    }
  }

  /** 未登录 / 登录中：直接打开或继续浏览器登录。 */
  function startOrContinueLogin() {
    if (gatewayView.signedIn) return;
    if (isLoginPending(gatewayView)) {
      void runGateway(() => window.dex.reopenGatewayLogin());
      return;
    }
    void runGateway(() => window.dex.startGatewayLogin());
  }

  function watchGatewaySession() {
    if (!window.dex.onGatewaySession) return;
    window.dex.onGatewaySession((/** @type {GatewaySessionView} */ view) => {
      gatewayView = view || emptySessionView();
      paintGearAccount();
      if (accountOpen) {
        if (!gatewayView.signedIn && !isLoginPending(gatewayView)) setAccountOpen(false);
        else paintAccountPopover();
      }
    });
    void window.dex
      .gatewaySession()
      .then((/** @type {GatewaySessionView} */ view) => {
        gatewayView = view || emptySessionView();
        paintGearAccount();
        if (accountOpen) paintAccountPopover();
      })
      .catch(() => {
        paintGearAccount();
      });
  }

  /** @param {string} [pluginId] */
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
    session = /** @type {ChromeSession} */ (next);
    if (session.surface === 'settings') {
      apply();
      void settings.enterSettings().catch((/** @type {unknown} */ err) => {
        setStatus(err instanceof Error ? err.message : '无法打开设置', 'error');
      });
      return;
    }
    if (session.surface === 'plugins') plugins.suspend();
    apply();
  });

  reloadBtn.addEventListener('click', () => {
    void plugins.reloadActive();
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

  accountBtn.addEventListener('click', () => {
    if (!gatewayView.signedIn) {
      setAccountOpen(false);
      startOrContinueLogin();
      return;
    }
    setAccountOpen(!accountOpen);
  });

  usernameEl.addEventListener('click', (event) => {
    if (gatewayView.signedIn) return;
    event.stopPropagation();
    startOrContinueLogin();
  });

  usernameEl.addEventListener('keydown', (event) => {
    if (gatewayView.signedIn) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    startOrContinueLogin();
  });

  popover.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!button) return;
    setPopover(false);
    if (button.id === 'gear-open-settings') void openSettings();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (popoverOpen) setPopover(false);
      if (accountOpen) setAccountOpen(false);
    }
    if (event.key !== ',' || event.shiftKey || event.altKey) return;
    const modified = usesCommand ? event.metaKey : event.ctrlKey;
    if (!modified) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
    event.preventDefault();
    setPopover(false);
    setAccountOpen(false);
    void openSettings();
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (popoverOpen && !popover.contains(target) && !gearBtn.contains(target)) {
      setPopover(false);
    }
    if (accountOpen && !accountPopover.contains(target) && !accountBtn.contains(target)) {
      setAccountOpen(false);
    }
  });

  watchGatewaySession();
  apply();

  return {
    session() {
      return session;
    },
    refresh() {
      apply();
    },
    enterPlugins: openPlugins,
    /** @param {string} pluginId */
    focusPlugin(pluginId) {
      const next = selectPluginsFocus(session, pluginId);
      if (next === session) return;
      session = next;
      apply();
    },
    /** @param {string} pluginId */
    async usePlugin(pluginId) {
      const plugin = shell.plugins.find((/** @type {PluginSummary} */ item) => item.id === pluginId);
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
