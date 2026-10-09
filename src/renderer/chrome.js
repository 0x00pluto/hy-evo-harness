import {
  canCollapse,
  canGoBack,
  clearForward,
  createChromeSession,
  enterSettings as enterSettingsState,
  goBack,
  goForward,
  togglePin,
} from './chrome-state.js';

const LOCAL_USER_LABEL = '本地用户';

export function mountChrome({ settings, setStatus }) {
  const backBtn = document.getElementById('history-back');
  const forwardBtn = document.getElementById('history-forward');
  const collapseBtn = document.getElementById('sidebar-toggle');
  const gearBtn = document.getElementById('rail-settings');
  const popover = document.getElementById('gear-popover');
  const usernameEl = document.getElementById('gear-username');
  const settingsNav = document.getElementById('settings-nav');
  const settingsSplitter = document.getElementById('settings-splitter');
  const homeBtn = document.getElementById('rail-home');
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
    settingsNav.hidden = !settingsOpen;
    settingsSplitter.hidden = !settingsOpen;
    backBtn.disabled = !canGoBack(session);
    forwardBtn.disabled = !session.canForward;
    collapseBtn.hidden = settingsOpen;
    collapseBtn.disabled = !canCollapse(session);
    collapseBtn.setAttribute('aria-pressed', session.pinned ? 'false' : 'true');
    if (!floating()) {
      window.clearTimeout(closeTimer);
      sidebar.classList.remove('is-open');
    }
    if (session.surface !== 'workspace') setPopover(false);
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

  async function openSettings() {
    const next = enterSettingsState(session);
    if (next === session) return;
    session = next;
    apply();
    try {
      await settings.enterSettings();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '无法打开设置', 'error');
    }
  }

  function leaveToWorkspace() {
    const next = goBack(session);
    if (next === session) return;
    session = next;
    settings.leaveSettings();
    apply();
  }

  backBtn.addEventListener('click', leaveToWorkspace);

  homeBtn.addEventListener('click', () => {
    if (session.surface !== 'settings') return;
    leaveToWorkspace();
  });

  forwardBtn.addEventListener('click', () => {
    const next = goForward(session);
    if (next === session) return;
    session = next;
    apply();
    void settings.enterSettings().catch((err) => {
      setStatus(err instanceof Error ? err.message : '无法打开设置', 'error');
    });
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
    clearForward() {
      const next = clearForward(session);
      if (next === session) return;
      session = next;
      apply();
    },
  };
}
