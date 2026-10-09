import { mountIcons } from './icons.js';

export function mountPlugins({
  shell,
  setStatus,
  settings,
  onClearNavigation = () => {},
  onOpenPluginSettings = () => {},
  onWorkspaceChanged = () => {},
  onListChanged = () => {},
}) {
  const nav = document.getElementById('plugin-nav');
  const welcome = document.getElementById('welcome-screen');
  const headless = document.getElementById('headless-screen');
  const viewportHost = document.getElementById('viewport-host');
  const dropZone = document.getElementById('drop-zone');
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
    card.append(name, status, hoverRule(), pathLine);
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
      meta.textContent = plugin.version;
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

  function showWelcome() {
    shell.activeId = null;
    welcome.hidden = false;
    headless.hidden = true;
    viewportHost.hidden = true;
    viewportHost.replaceChildren();
    settings.dismissSurface();
    renderNav();
    onWorkspaceChanged();
  }

  async function openPlugin(plugin) {
    shell.activeId = plugin.id;
    setStatus('');
    settings.dismissSurface();
    renderNav();

    try {
      if (plugin.type === 'ui' && plugin.uiUrl) {
        const prepared = await window.dex.preparePlugin(plugin.id);
        welcome.hidden = true;
        headless.hidden = true;
        viewportHost.hidden = false;
        viewportHost.replaceChildren();
        const webview = document.createElement('webview');
        webview.setAttribute('partition', prepared.partition);
        webview.setAttribute('preload', prepared.preloadUrl);
        webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');
        webview.setAttribute('src', plugin.uiUrl);
        viewportHost.appendChild(webview);
        onWorkspaceChanged();
        return;
      }

      welcome.hidden = true;
      viewportHost.hidden = true;
      viewportHost.replaceChildren();
      headless.hidden = false;
      headlessTitle.textContent = plugin.displayName;
      onWorkspaceChanged();
    } catch (err) {
      showWelcome();
      setStatus(err instanceof Error ? err.message : '打开插件失败', 'error');
    }
  }

  function forgetWorkspacePlugin() {
    shell.activeId = null;
    welcome.hidden = false;
    headless.hidden = true;
    viewportHost.hidden = true;
    viewportHost.replaceChildren();
    renderNav();
    onWorkspaceChanged();
  }

  async function refresh(nextPlugins) {
    shell.plugins = nextPlugins || (await window.dex.listPlugins());
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

  async function installZip(zipPath) {
    if (!zipPath || !zipPath.toLowerCase().endsWith('.zip')) {
      return { ok: false, message: '请拖入 .zip 插件包' };
    }
    return window.dex.installZip(zipPath);
  }

  function suspend() {
    pluginPane.hidden = true;
    welcome.hidden = true;
    headless.hidden = true;
    viewportHost.hidden = true;
    viewportHost.replaceChildren();
  }

  function resume(pluginId) {
    pluginPane.hidden = false;
    const plugin = shell.plugins.find((item) => item.id === pluginId);
    if (plugin) void openPlugin(plugin);
    else showWelcome();
  }

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
    event.stopPropagation();
    dropZone.classList.remove('dragover');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    onClearNavigation();
    const zipPath = window.dex.pathForFile(file);
    void (async () => {
      if (!zipPath || !zipPath.toLowerCase().endsWith('.zip')) {
        setStatus('请拖入 .zip 插件包', 'error');
        return;
      }
      setStatus('正在安装…');
      const result = await installZip(zipPath);
      if (!result.ok) {
        setStatus(result.message || '安装失败', 'error');
        return;
      }
      setStatus('插件已安装', 'ok');
      await refresh(result.plugins);
    })();
  });

  return { refresh, suspend, resume, openPlugin, installZip, showWelcome };
}
