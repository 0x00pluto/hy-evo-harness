import { mountIcons } from './icons.js';
import { mountPluginViews } from './plugin-views.js';
import { showShellToast } from './shell-toast.js';

export function mountPlugins({
  shell,
  setStatus,
  settings,
  onClearNavigation = () => {},
  onOpenPluginSettings = () => {},
  onOpenMarket = () => {},
  onWorkspaceChanged = () => {},
  onListChanged = () => {},
  onUnavailable = () => {},
}) {
  const nav = document.getElementById('plugin-nav');
  const welcome = document.getElementById('welcome-screen');
  const headless = document.getElementById('headless-screen');
  const viewportHost = document.getElementById('viewport-host');
  let openSeq = 0;
  const views = mountPluginViews({
    viewportHost,
    onReopened() {
      showShellToast('已重新打开', 'ok');
    },
    onFailed(id, message) {
      handleViewFailed(id, message);
    },
  });
  const openMarket = document.getElementById('open-market');
  const headlessTitle = document.getElementById('headless-title');
  const pluginPane = document.getElementById('plugin-pane');
  let hoverCard = null;
  let hideHoverTimer = null;
  nav.addEventListener('scroll', () => clearHoverCard());

  function clearHoverCard() {
    if (hideHoverTimer != null) {
      clearTimeout(hideHoverTimer);
      hideHoverTimer = null;
    }
    if (hoverCard) hoverCard.remove();
    hoverCard = null;
  }

  function scheduleHideHover() {
    if (hideHoverTimer != null) clearTimeout(hideHoverTimer);
    hideHoverTimer = setTimeout(clearHoverCard, 80);
  }

  function placeHoverCard(anchor) {
    if (!hoverCard) return;
    const rect = anchor.getBoundingClientRect();
    const box = hoverCard.getBoundingClientRect();
    let left = rect.right + 8;
    if (left + box.width > window.innerWidth - 8) left = Math.max(8, rect.left - 8 - box.width);
    let top = rect.top;
    const maxTop = window.innerHeight - box.height - 8;
    top = Math.max(8, Math.min(top, maxTop));
    hoverCard.style.left = `${left}px`;
    hoverCard.style.top = `${top}px`;
  }

  function displayPath(rootPath) {
    if (!rootPath) return '';
    const home = rootPath.match(/^\/Users\/[^/]+/);
    if (home && rootPath.startsWith(home[0])) return `~${rootPath.slice(home[0].length)}` || '~';
    return rootPath;
  }

  function hoverIcon(name) {
    const icon = document.createElement('i');
    icon.dataset.lucide = name;
    return icon;
  }

  function hoverRow(iconName, text) {
    const row = document.createElement('div');
    row.className = 'nav-hover-row';
    const label = document.createElement('span');
    label.textContent = text;
    row.append(hoverIcon(iconName), label);
    return row;
  }

  function hoverRule() {
    const rule = document.createElement('div');
    rule.className = 'nav-hover-rule';
    rule.setAttribute('role', 'separator');
    return rule;
  }

  function showHoverCard(anchor, plugin) {
    clearHoverCard();
    const card = document.createElement('div');
    card.className = 'nav-hover-card';
    const name = hoverRow('puzzle', plugin.displayName);
    name.classList.add('nav-hover-name');
    const status = hoverRow('tag', plugin.version || '');
    status.classList.add('nav-hover-muted');
    const pathText = displayPath(plugin.rootPath);
    const pathLine = document.createElement('button');
    pathLine.type = 'button';
    pathLine.className = 'nav-hover-row nav-hover-muted nav-hover-path';
    const pathLabel = document.createElement('span');
    pathLabel.textContent = pathText;
    const jump = hoverIcon('arrow-up-right');
    jump.classList.add('nav-hover-jump');
    pathLine.append(hoverIcon('folder'), pathLabel, jump);
    pathLine.title = plugin.rootPath || '';
    pathLine.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!plugin.rootPath) return;
      void window.dex.openPluginFolder(plugin.rootPath);
    });
    card.append(name, status, hoverRule());
    const source = hoverSource(plugin);
    if (source) {
      const sourceRow = hoverRow(source.icon, source.text);
      sourceRow.classList.add('nav-hover-muted');
      card.append(sourceRow);
    }
    card.append(pathLine);
    if (plugin.hasSettings) {
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.className = 'nav-hover-row nav-hover-settings';
      const label = document.createElement('span');
      label.textContent = '插件设置';
      gear.append(hoverIcon('settings'), label);
      gear.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearHoverCard();
        onOpenPluginSettings(plugin.id);
      });
      card.append(hoverRule(), gear);
    }
    card.addEventListener('pointerenter', () => {
      if (hideHoverTimer != null) {
        clearTimeout(hideHoverTimer);
        hideHoverTimer = null;
      }
    });
    card.addEventListener('pointerleave', scheduleHideHover);
    document.body.appendChild(card);
    mountIcons(card);
    hoverCard = card;
    placeHoverCard(anchor);
  }

  function hoverSource(plugin) {
    if (plugin.source === 'bundled') return { icon: 'boxes', text: '来自示例' };
    if (plugin.source === 'local' || plugin.source === 'dev') return { icon: 'code', text: '开发版' };
    if (plugin.originChannel === 'market') return { icon: 'store', text: '来自市场' };
    if (plugin.source === 'installed') return { icon: 'file-archive', text: '来自压缩包' };
    return null;
  }

  function navGlyph() {
    const icon = document.createElement('i');
    icon.dataset.lucide = 'puzzle';
    return icon;
  }

  function navMark(plugin) {
    const mark = document.createElement('span');
    mark.className = 'plugin-mark plugin-mark-nav';
    if (plugin.iconUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = plugin.iconUrl;
      img.addEventListener('error', () => {
        img.replaceWith(navGlyph());
        mountIcons(mark);
      });
      mark.appendChild(img);
    } else {
      mark.appendChild(navGlyph());
    }
    return mark;
  }

  function renderNav() {
    clearHoverCard();
    nav.replaceChildren();
    if (shell.plugins.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-nav';
      empty.textContent = '还没有可用插件';
      nav.appendChild(empty);
      return;
    }

    for (const plugin of shell.plugins) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item';
      if (plugin.id === shell.activeId) button.classList.add('active');
      button.setAttribute('aria-current', plugin.id === shell.activeId ? 'true' : 'false');

      const text = document.createElement('span');
      text.className = 'nav-text';
      const title = document.createElement('span');
      title.className = 'nav-title';
      title.textContent = plugin.displayName;
      const meta = document.createElement('span');
      meta.className = 'nav-meta';
      if (plugin.runtimeError || plugin.previewError) {
        meta.textContent = '环境未就绪';
        meta.classList.add('is-danger');
      } else {
        meta.textContent = plugin.version;
      }
      text.append(title, meta);

      button.append(navMark(plugin), text);
      button.addEventListener('pointerenter', () => {
        if (hideHoverTimer != null) {
          clearTimeout(hideHoverTimer);
          hideHoverTimer = null;
        }
        showHoverCard(button, plugin);
      });
      button.addEventListener('pointerleave', (event) => {
        if (hoverCard && event.relatedTarget instanceof Node && hoverCard.contains(event.relatedTarget)) return;
        scheduleHideHover();
      });
      button.addEventListener('click', () => {
        clearHoverCard();
        // 从宽侧栏打开插件会打断「回到插件详情」和前进。
        onClearNavigation();
        void openPlugin(plugin);
      });
      nav.appendChild(button);
    }
    mountIcons(nav);
  }

  function workspaceOpen() {
    return document.body.dataset.surface === 'workspace' && !pluginPane.hidden;
  }

  function isUi(plugin) {
    return plugin.type === 'ui' && !!plugin.uiUrl;
  }

  function revealViewport() {
    welcome.hidden = true;
    headless.hidden = true;
    viewportHost.hidden = false;
  }

  function showWelcome() {
    openSeq += 1;
    views.parkHot();
    shell.activeId = null;
    welcome.hidden = false;
    headless.hidden = true;
    viewportHost.hidden = true;
    settings.dismissSurface();
    renderNav();
    onWorkspaceChanged();
    void views.enforceQuota(null);
  }

  function handleViewFailed(id, message) {
    if (shell.activeId !== id || !workspaceOpen()) return;
    showWelcome();
    setStatus(message || '打开插件失败', 'error');
  }

  async function openPlugin(plugin) {
    if (plugin.runtimeError || plugin.previewError) {
      setStatus('');
      onUnavailable(plugin.id);
      return;
    }
    const seq = ++openSeq;
    pluginPane.hidden = false;
    shell.activeId = plugin.id;
    setStatus('');
    settings.dismissSurface();
    renderNav();

    if (!isUi(plugin)) {
      views.parkHot();
      welcome.hidden = true;
      viewportHost.hidden = true;
      headless.hidden = false;
      headlessTitle.textContent = plugin.displayName;
      onWorkspaceChanged();
      await views.enforceQuota(null);
      return;
    }

    if (views.isShowing(plugin.id)) {
      revealViewport();
      onWorkspaceChanged();
      return;
    }

    views.parkHot();

    if (views.has(plugin.id)) {
      try {
        await window.dex.preparePlugin(plugin.id);
      } catch {
        // 页面还在。partition 上次打开时已经准备过，这次失败不换节点。
      }
      if (seq !== openSeq || !workspaceOpen()) return;
      revealViewport();
      views.present(plugin.id);
      onWorkspaceChanged();
      await views.enforceQuota(plugin.id);
      return;
    }

    try {
      const prepared = await window.dex.preparePlugin(plugin.id);
      if (seq !== openSeq || !workspaceOpen()) return;
      revealViewport();
      views.mount(plugin, prepared);
      onWorkspaceChanged();
      await views.enforceQuota(plugin.id);
    } catch (err) {
      if (seq !== openSeq) return;
      showWelcome();
      setStatus(err instanceof Error ? err.message : '打开插件失败', 'error');
    }
  }

  function forgetWorkspacePlugin() {
    openSeq += 1;
    shell.activeId = null;
    welcome.hidden = false;
    headless.hidden = true;
    viewportHost.hidden = true;
    renderNav();
    onWorkspaceChanged();
  }

  async function refresh(nextPlugins) {
    shell.plugins = nextPlugins || (await window.dex.listPlugins());
    const live = new Set(shell.plugins.map((plugin) => plugin.id));
    for (const id of views.ids()) {
      if (!live.has(id)) views.drop(id, 'force');
    }
    renderNav();
    onListChanged();
    if (shell.settingsMode) {
      await settings.onPluginsChanged();
      return;
    }
    if (shell.activeId && !shell.plugins.some((plugin) => plugin.id === shell.activeId)) {
      if (document.body.dataset.surface === 'workspace') showWelcome();
      else forgetWorkspacePlugin();
    }
  }

  function suspend() {
    const shown = views.parkHot();
    const protectedId = views.has(shell.activeId) ? shell.activeId : shown;
    pluginPane.hidden = true;
    welcome.hidden = true;
    headless.hidden = true;
    viewportHost.hidden = true;
    void views.enforceQuota(protectedId);
  }

  function resume(pluginId) {
    pluginPane.hidden = false;
    const plugin = shell.plugins.find((item) => item.id === pluginId);
    if (plugin) void openPlugin(plugin);
    else showWelcome();
  }

  function releaseView(id) {
    views.drop(id, 'force');
  }

  function reopenIfWatching(id) {
    if (!id || !workspaceOpen() || shell.activeId !== id) return;
    const plugin = shell.plugins.find((item) => item.id === id);
    if (!plugin) return;
    void openPlugin(plugin);
  }

  async function reloadActive() {
    if (!workspaceOpen()) return;
    const plugin = shell.plugins.find((item) => item.id === shell.activeId);
    if (!plugin || !isUi(plugin)) return;
    if (plugin.source === 'local') {
      try {
        const result = await window.dex.reloadUnpacked(plugin.id);
        if (result.plugins) await refresh(result.plugins);
        if (!result.ok) {
          setStatus(result.message || '重新加载失败', 'error');
          return;
        }
        setStatus('已重新加载', 'ok');
      } catch (err) {
        setStatus(err instanceof Error ? err.message : '重新加载失败', 'error');
        return;
      }
      views.drop(plugin.id, 'force');
      const next = shell.plugins.find((item) => item.id === plugin.id);
      if (next) await openPlugin(next);
      return;
    }
    views.drop(plugin.id, 'force');
    await openPlugin(plugin);
  }

  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
  openMarket.addEventListener('click', () => onOpenMarket());

  return {
    refresh,
    suspend,
    resume,
    openPlugin,
    showWelcome,
    releaseView,
    reopenIfWatching,
    reloadActive,
  };
}
