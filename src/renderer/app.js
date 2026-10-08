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

let plugins = [];
let activeId = null;

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
      const prepared = await window.hub.preparePlugin(plugin.id);
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
  plugins = nextPlugins || (await window.hub.listPlugins());
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
  const result = await window.hub.installZip(zipPath);
  if (!result.ok) {
    setStatus(result.message || '安装失败', 'error');
    return;
  }
  setStatus('插件已安装', 'ok');
  await refresh(result.plugins);
}

async function uninstallActive() {
  if (!activeId) return;
  const result = await window.hub.uninstall(activeId);
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
  const result = await window.hub.pickAndInstall();
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
  const zipPath = window.hub.pathForFile(file);
  void installFromPath(zipPath);
});

void refresh().catch((err) => {
  setStatus(err instanceof Error ? err.message : '无法读取插件列表', 'error');
});
