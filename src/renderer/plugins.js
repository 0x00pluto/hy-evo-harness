export function mountPlugins({
  shell,
  setStatus,
  settings,
  onClearNavigation = () => {},
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

  function sourceLabel(source) {
    if (source === 'installed') return '已安装';
    if (source === 'dev') return '开发';
    return '内置';
  }

  function renderNav() {
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
        // 从宽侧栏打开插件会打断「回到插件详情」和前进。
        onClearNavigation();
        void openPlugin(plugin);
      });
      nav.appendChild(button);
    }
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
