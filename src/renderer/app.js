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
const pluginPane = document.getElementById('plugin-pane');
const settingsNav = document.getElementById('settings-nav');
const settingsBack = document.getElementById('settings-back');
const settingsSearch = document.getElementById('settings-search');
const settingsList = document.getElementById('settings-list');
const settingsBtn = document.getElementById('settings-btn');
const settingsScreen = document.getElementById('settings-screen');
const settingsTitle = document.getElementById('settings-plugin-title');
const settingsSchemaError = document.getElementById('settings-schema-error');
const settingsForm = document.getElementById('settings-form');
const settingsActions = document.getElementById('settings-actions');
const settingsSave = document.getElementById('settings-save');
const settingsEmpty = document.getElementById('settings-empty');
const settingsEntryHost = document.getElementById('settings-entry-host');

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
let settingsMode = false;
let settingsCatalog = [];
let activeSettingsId = null;
let settingsDraft = null;
let returnPluginId = null;
let savingSettings = false;

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
  settingsScreen.hidden = true;
  settingsEntryHost.replaceChildren();
  renderNav();
}

async function openPlugin(plugin) {
  activeId = plugin.id;
  setStatus('');
  settingsScreen.hidden = true;
  settingsEntryHost.replaceChildren();
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
  if (settingsMode) {
    await reloadSettingsCatalog();
    if (activeSettingsId && !settingsCatalog.some((plugin) => plugin.id === activeSettingsId)) {
      activeSettingsId = null;
      settingsDraft = null;
      const first = visibleSettings()[0];
      if (first) await selectSettings(first.id);
      else clearSettingsMain();
    }
    return;
  }
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

function settingsQueryText() {
  return settingsSearch.value.trim().toLowerCase();
}

function pluginMatchesSettings(plugin, query) {
  if (!query) return true;
  const parts = [plugin.displayName];
  for (const field of plugin.fields) {
    parts.push(field.title);
    if (field.description) parts.push(field.description);
  }
  return parts.some((text) => String(text).toLowerCase().includes(query));
}

function visibleSettings() {
  const query = settingsQueryText();
  return settingsCatalog.filter((plugin) => pluginMatchesSettings(plugin, query));
}

function draftFromPlugin(plugin) {
  const values = {};
  const secrets = {};
  for (const field of plugin.fields) {
    if (field.secret) {
      secrets[field.key] = { action: 'keep' };
      continue;
    }
    if (field.type === 'number') {
      values[field.key] = typeof field.value === 'number' ? field.value : '';
    } else if (field.type === 'boolean') {
      values[field.key] = field.value === true;
    } else {
      values[field.key] = typeof field.value === 'string' ? field.value : '';
    }
  }
  return { values, secrets };
}

function payloadFromDraft(plugin, draft) {
  const values = {};
  const secrets = {};
  for (const field of plugin.fields) {
    if (field.secret) {
      const intent = draft.secrets[field.key] || { action: 'keep' };
      if (intent.action === 'set') secrets[field.key] = { action: 'set', value: intent.value };
      else if (intent.action === 'clear') secrets[field.key] = { action: 'clear' };
      else secrets[field.key] = { action: 'keep' };
      continue;
    }
    let value = draft.values[field.key];
    if (field.type === 'number') {
      value = typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    values[field.key] = value;
  }
  return { values, secrets };
}

function restoreFieldDefault(field) {
  if (field.secret) {
    const next = typeof field.default === 'string' ? field.default : '';
    settingsDraft.secrets[field.key] = next === '' ? { action: 'clear' } : { action: 'set', value: next };
    return;
  }
  if (field.type === 'number') {
    settingsDraft.values[field.key] = typeof field.default === 'number' ? field.default : '';
    return;
  }
  if (field.type === 'boolean') {
    settingsDraft.values[field.key] = field.default === true;
    return;
  }
  settingsDraft.values[field.key] = typeof field.default === 'string' ? field.default : '';
}

function renderSettingsNav() {
  settingsList.replaceChildren();
  const visible = visibleSettings();
  if (settingsCatalog.length === 0 || visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-nav';
    empty.textContent = settingsCatalog.length === 0 ? '没有可配置的插件' : '没有结果';
    settingsList.appendChild(empty);
    return;
  }
  for (const plugin of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    if (plugin.id === activeSettingsId) button.classList.add('active');
    button.setAttribute('aria-current', plugin.id === activeSettingsId ? 'true' : 'false');
    const title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = plugin.displayName;
    button.append(title);
    button.addEventListener('click', () => {
      if (plugin.id === activeSettingsId) return;
      void selectSettings(plugin.id);
    });
    settingsList.appendChild(button);
  }
}

function clearSettingsMain() {
  settingsTitle.textContent = '';
  settingsSchemaError.hidden = true;
  settingsSchemaError.textContent = '';
  settingsForm.replaceChildren();
  settingsActions.hidden = true;
  settingsEmpty.hidden = false;
  settingsEmpty.textContent = settingsCatalog.length === 0 ? '没有可配置的插件' : '没有结果';
  settingsEntryHost.hidden = true;
  settingsEntryHost.replaceChildren();
}

function appendReset(parent, field, plugin) {
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'settings-reset';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => {
    restoreFieldDefault(field);
    renderSettingsForm(plugin);
  });
  parent.appendChild(reset);
}

function renderSettingsForm(plugin) {
  settingsForm.replaceChildren();
  if (!settingsDraft || plugin.schemaError || plugin.fields.length === 0) return;
  for (const field of plugin.fields) {
    const card = document.createElement('article');
    card.className = 'settings-card';
    const copy = document.createElement('div');
    copy.className = 'settings-card-copy';
    const heading = document.createElement('h2');
    heading.textContent = field.title;
    copy.appendChild(heading);
    if (field.description) {
      const description = document.createElement('p');
      description.textContent = field.description;
      copy.appendChild(description);
    }
    appendReset(copy, field, plugin);
    const control = document.createElement('div');
    control.className = 'settings-control';
    control.appendChild(renderFieldControl(field, plugin));
    card.append(copy, control);
    settingsForm.appendChild(card);
  }
}

function renderFieldControl(field) {
  if (field.type === 'boolean') return renderSwitch(field);
  if (field.type === 'select') return renderSelect(field);
  if (field.type === 'path') return renderPath(field);
  if (field.secret) return renderSecret(field);
  return renderText(field, field.type === 'number' ? 'number' : 'text');
}

function renderSwitch(field) {
  const label = document.createElement('label');
  label.className = 'settings-switch';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = settingsDraft.values[field.key] === true;
  input.setAttribute('aria-label', field.title);
  input.addEventListener('change', () => {
    settingsDraft.values[field.key] = input.checked;
  });
  const track = document.createElement('span');
  label.append(input, track);
  return label;
}

function renderSelect(field) {
  const select = document.createElement('select');
  select.className = 'settings-select';
  select.setAttribute('aria-label', field.title);
  for (const option of field.options || []) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    select.appendChild(item);
  }
  select.value = typeof settingsDraft.values[field.key] === 'string' ? settingsDraft.values[field.key] : '';
  select.addEventListener('change', () => {
    settingsDraft.values[field.key] = select.value;
  });
  return select;
}

function renderText(field, type) {
  const input = document.createElement('input');
  input.className = 'settings-input';
  input.type = type;
  input.setAttribute('aria-label', field.title);
  if (type === 'number') {
    const current = settingsDraft.values[field.key];
    input.value = typeof current === 'number' && Number.isFinite(current) ? String(current) : '';
    input.addEventListener('input', () => {
      settingsDraft.values[field.key] = input.value === '' ? '' : input.valueAsNumber;
    });
  } else {
    input.value = typeof settingsDraft.values[field.key] === 'string' ? settingsDraft.values[field.key] : '';
    input.addEventListener('input', () => {
      settingsDraft.values[field.key] = input.value;
    });
  }
  return input;
}

function renderSecret(field) {
  const wrap = document.createElement('div');
  wrap.className = 'settings-control';
  const input = document.createElement('input');
  input.className = 'settings-input';
  input.type = 'password';
  input.autocomplete = 'new-password';
  input.spellcheck = false;
  input.setAttribute('aria-label', field.title);
  const intent = settingsDraft.secrets[field.key] || { action: 'keep' };
  input.value = intent.action === 'set' ? intent.value : '';
  const syncPlaceholder = () => {
    const current = settingsDraft.secrets[field.key];
    input.placeholder = field.secretSet && (!current || current.action === 'keep') ? '已设置' : '';
  };
  syncPlaceholder();
  input.addEventListener('input', () => {
    if (input.value === '') {
      const current = settingsDraft.secrets[field.key];
      if (!current || current.action !== 'clear') settingsDraft.secrets[field.key] = { action: 'keep' };
    } else {
      settingsDraft.secrets[field.key] = { action: 'set', value: input.value };
    }
    syncPlaceholder();
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'settings-text-btn';
  clear.textContent = '清除';
  clear.addEventListener('click', () => {
    settingsDraft.secrets[field.key] = { action: 'clear' };
    input.value = '';
    syncPlaceholder();
  });
  wrap.append(input, clear);
  return wrap;
}

function renderPath(field) {
  const wrap = document.createElement('div');
  wrap.className = 'settings-control';
  const value = document.createElement('span');
  value.className = 'settings-path-value';
  const current = typeof settingsDraft.values[field.key] === 'string' ? settingsDraft.values[field.key] : '';
  value.textContent = current || '未选择';
  value.title = current;
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'settings-text-btn path-change';
  change.textContent = '更改';
  change.addEventListener('click', async () => {
    const picked = await window.dex.pickDirectory();
    if (!picked || picked.cancelled || !picked.path) return;
    settingsDraft.values[field.key] = picked.path;
    value.textContent = picked.path;
    value.title = picked.path;
  });
  wrap.append(value, change);
  return wrap;
}

async function renderSettingsMain(plugin, mountEntry) {
  settingsTitle.textContent = plugin.displayName;
  settingsSchemaError.hidden = !plugin.schemaError;
  settingsSchemaError.textContent = plugin.schemaError || '';
  renderSettingsForm(plugin);
  const canSave = plugin.fields.length > 0 && !plugin.schemaError;
  settingsActions.hidden = !canSave;
  const bare = !plugin.schemaError && plugin.fields.length === 0 && !plugin.settingsEntryUrl;
  settingsEmpty.hidden = !bare;
  settingsEmpty.textContent = bare ? '这个插件没有可编辑的配置' : '';
  if (mountEntry) await mountSettingsEntry(plugin);
}

async function mountSettingsEntry(plugin) {
  settingsEntryHost.replaceChildren();
  if (!plugin.settingsEntryUrl) {
    settingsEntryHost.hidden = true;
    return;
  }
  const prepared = await window.dex.preparePlugin(plugin.id);
  if (activeSettingsId !== plugin.id) return;
  settingsEntryHost.hidden = false;
  const webview = document.createElement('webview');
  webview.setAttribute('partition', prepared.partition);
  webview.setAttribute('preload', prepared.preloadUrl);
  webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes');
  webview.setAttribute('src', plugin.settingsEntryUrl);
  settingsEntryHost.appendChild(webview);
}

function reloadSettingsWebview() {
  const webview = settingsEntryHost.querySelector('webview');
  if (webview && typeof webview.reload === 'function') webview.reload();
}

async function reloadSettingsCatalog() {
  settingsCatalog = await window.dex.settingsCatalog();
  renderSettingsNav();
}

async function selectSettings(id) {
  const plugin = settingsCatalog.find((item) => item.id === id);
  if (!plugin) return;
  activeSettingsId = id;
  settingsDraft = draftFromPlugin(plugin);
  renderSettingsNav();
  try {
    await renderSettingsMain(plugin, true);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : '打开设置页失败', 'error');
  }
}

async function enterSettings() {
  if (settingsMode) return;
  returnPluginId = activeId;
  settingsMode = true;
  settingsSearch.value = '';
  pluginPane.hidden = true;
  settingsNav.hidden = false;
  installBtn.hidden = true;
  welcome.hidden = true;
  headless.hidden = true;
  toolbar.hidden = true;
  viewportHost.hidden = true;
  viewportHost.replaceChildren();
  settingsScreen.hidden = false;
  setStatus('');
  await reloadSettingsCatalog();
  const first = visibleSettings()[0];
  if (first) await selectSettings(first.id);
  else clearSettingsMain();
}

function leaveSettings() {
  const backTo = returnPluginId;
  settingsMode = false;
  activeSettingsId = null;
  settingsDraft = null;
  pluginPane.hidden = false;
  settingsNav.hidden = true;
  installBtn.hidden = false;
  settingsScreen.hidden = true;
  settingsEntryHost.replaceChildren();
  const plugin = plugins.find((item) => item.id === backTo);
  if (plugin) void openPlugin(plugin);
  else showWelcome();
}

function onSettingsSearch() {
  const visible = visibleSettings();
  if (activeSettingsId && !visible.some((plugin) => plugin.id === activeSettingsId)) {
    activeSettingsId = null;
    settingsDraft = null;
    clearSettingsMain();
  }
  renderSettingsNav();
}

async function saveActiveSettings() {
  const plugin = settingsCatalog.find((item) => item.id === activeSettingsId);
  if (!plugin || !settingsDraft || savingSettings) return;
  savingSettings = true;
  settingsSave.disabled = true;
  try {
    const result = await window.dex.savePluginSettings(plugin.id, payloadFromDraft(plugin, settingsDraft));
    if (!result.ok) {
      setStatus(result.message || '保存失败', 'error');
      return;
    }
    setStatus('已保存', 'ok');
    await reloadSettingsCatalog();
    const fresh = settingsCatalog.find((item) => item.id === plugin.id);
    if (!fresh || activeSettingsId !== plugin.id) return;
    settingsDraft = draftFromPlugin(fresh);
    await renderSettingsMain(fresh, false);
    reloadSettingsWebview();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : '保存失败', 'error');
  } finally {
    savingSettings = false;
    settingsSave.disabled = false;
  }
}

settingsBtn.addEventListener('click', () => {
  void enterSettings().catch((err) => {
    setStatus(err instanceof Error ? err.message : '无法打开设置', 'error');
  });
});
settingsBack.addEventListener('click', () => {
  leaveSettings();
});
settingsSearch.addEventListener('input', () => {
  onSettingsSearch();
});
settingsSave.addEventListener('click', () => {
  void saveActiveSettings();
});

void refresh().catch((err) => {
  setStatus(err instanceof Error ? err.message : '无法读取插件列表', 'error');
});
