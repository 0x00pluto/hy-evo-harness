import {
  GENERAL_NAV_ID,
  PRODUCT_NAME,
  generalNavMatches,
  localUserLabel,
  preferredSettingsId,
  updateCheckNote,
  updateDialogInsteadOfCheck,
} from './general-settings.js';
import { mountIcons } from './icons.js';

const GENERAL_GROUP = '通用配置';
const SETTINGS_SOURCE = {
  bundled: '示例',
  dev: '开发',
  local: '本地',
  installed: '已安装',
};

function settingsSourceLabel(source) {
  return SETTINGS_SOURCE[source] || '内置';
}

export function mountSettings({ shell, setStatus, plugins, updater = {} }) {
  const settingsSearch = document.getElementById('settings-search');
  const settingsList = document.getElementById('settings-list');
  const settingsScreen = document.getElementById('settings-screen');
  const settingsTitle = document.getElementById('settings-plugin-title');
  const settingsSchemaError = document.getElementById('settings-schema-error');
  const settingsForm = document.getElementById('settings-form');
  const settingsActions = document.getElementById('settings-actions');
  const settingsSave = document.getElementById('settings-save');
  const settingsEmpty = document.getElementById('settings-empty');
  const settingsEntryHost = document.getElementById('settings-entry-host');
  const discardDialog = document.getElementById('settings-discard-dialog');
  const discardStay = document.getElementById('settings-discard-stay');
  const discardConfirm = document.getElementById('settings-discard-confirm');

  let settingsCatalog = [];
  let activeSettingsId = null;
  let settingsDraft = null;
  let settingsBaseline = '';
  let returnPluginId = null;
  let savingSettings = false;
  let discardResolver = null;
  let generalNodes = null;
  let checkRequested = false;
  let stopUpdateWatch = null;

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

  function rememberBaseline() {
    settingsBaseline = JSON.stringify(settingsDraft);
    syncSaveButton();
  }

  function isDirty() {
    return Boolean(settingsDraft) && JSON.stringify(settingsDraft) !== settingsBaseline;
  }

  function syncSaveButton() {
    const plugin = settingsCatalog.find((item) => item.id === activeSettingsId);
    const canEdit = Boolean(plugin && plugin.fields.length > 0 && !plugin.schemaError);
    settingsSave.disabled = savingSettings || !canEdit || !isDirty();
  }

  function finishDiscard(allowed) {
    const resolve = discardResolver;
    discardResolver = null;
    if (discardDialog.open) discardDialog.close();
    if (resolve) resolve(allowed);
  }

  function confirmDiscard() {
    if (!isDirty()) return Promise.resolve(true);
    if (discardResolver) return Promise.resolve(false);
    return new Promise((resolve) => {
      discardResolver = resolve;
      discardDialog.showModal();
    });
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
    const query = settingsQueryText();
    const showGeneral = generalNavMatches(query);
    const visible = visibleSettings();
    if (!showGeneral && visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-nav';
      empty.textContent = '没有结果';
      settingsList.appendChild(empty);
      return;
    }
    if (showGeneral) {
      settingsList.appendChild(navSectionTitle('个人设置'));
      settingsList.appendChild(generalNavButton());
    }
    if (visible.length > 0) {
      settingsList.appendChild(navSectionTitle('插件'));
      for (const plugin of visible) settingsList.appendChild(pluginNavButton(plugin));
    }
    mountIcons(settingsList);
  }

  function navSectionTitle(text) {
    const title = document.createElement('div');
    title.className = 'section-title settings-nav-section';
    title.textContent = text;
    return title;
  }

  function generalNavButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item plugin-row';
    const selected = activeSettingsId === GENERAL_NAV_ID;
    if (selected) button.classList.add('active');
    button.setAttribute('aria-current', selected ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'plugin-row-copy';
    const mark = document.createElement('span');
    mark.className = 'plugin-mark plugin-mark-nav';
    const icon = document.createElement('i');
    icon.dataset.lucide = 'sliders-horizontal';
    mark.appendChild(icon);
    const title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = '通用设置';
    copy.append(mark, title);
    button.appendChild(copy);
    button.addEventListener('click', () => {
      void selectSettings(GENERAL_NAV_ID);
    });
    return button;
  }

  function pluginNavButton(plugin) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item plugin-row';
    if (plugin.id === activeSettingsId) button.classList.add('active');
    button.setAttribute('aria-current', plugin.id === activeSettingsId ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'plugin-row-copy';
    const title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = plugin.displayName;
    const text = document.createElement('span');
    text.className = 'nav-text';
    text.appendChild(title);
    if (plugin.source) {
      const meta = document.createElement('span');
      meta.className = 'nav-meta';
      meta.textContent = settingsSourceLabel(plugin.source);
      text.appendChild(meta);
    }
    copy.append(pluginMark(plugin), text);
    button.appendChild(copy);
    button.addEventListener('click', () => {
      void selectSettings(plugin.id);
    });
    return button;
  }

  function defaultGlyph() {
    const icon = document.createElement('i');
    icon.dataset.lucide = 'puzzle';
    return icon;
  }

  function pluginMark(plugin) {
    const mark = document.createElement('span');
    mark.className = 'plugin-mark plugin-mark-nav';
    if (plugin.iconUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = plugin.iconUrl;
      img.addEventListener('error', () => {
        img.replaceWith(defaultGlyph());
        mountIcons(mark);
      });
      mark.appendChild(img);
    } else {
      mark.appendChild(defaultGlyph());
    }
    return mark;
  }

  function hidePluginSettingsChrome() {
    settingsSchemaError.hidden = true;
    settingsSchemaError.textContent = '';
    settingsActions.hidden = true;
    settingsEmpty.hidden = true;
    settingsEmpty.textContent = '';
    settingsEntryHost.hidden = true;
    settingsEntryHost.replaceChildren();
  }

  function settingsGroup(name) {
    const section = document.createElement('section');
    section.className = 'settings-group';
    const heading = document.createElement('h2');
    heading.className = 'settings-group-title';
    heading.textContent = name;
    const body = document.createElement('div');
    body.className = 'settings-group-body';
    section.append(heading, body);
    return { section, body };
  }

  function hostValue(text) {
    const value = document.createElement('span');
    value.className = 'settings-host-value';
    value.textContent = text;
    return value;
  }

  function secondaryButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settings-text-btn path-change';
    button.textContent = label;
    return button;
  }

  function watchUpdates() {
    if (stopUpdateWatch || typeof updater.onStatus !== 'function') return;
    stopUpdateWatch = updater.onStatus(onUpdaterStatus);
  }

  function syncGeneralUpdate(payload) {
    if (!generalNodes || activeSettingsId !== GENERAL_NAV_ID) return;
    const status = payload && payload.status;
    const noteText = updateCheckNote(status, payload && payload.errorMessage);
    generalNodes.note.hidden = noteText === '';
    generalNodes.note.textContent = noteText;
    generalNodes.note.classList.toggle('is-error', status === 'error');
    generalNodes.checkBtn.disabled = status === 'checking';
  }

  function onUpdaterStatus(payload) {
    syncGeneralUpdate(payload);
    if (!checkRequested || !payload) return;
    const status = payload.status;
    if (status === 'downloading' || status === 'readyToInstall') {
      checkRequested = false;
      if (typeof updater.openInstallDialog === 'function') updater.openInstallDialog();
      return;
    }
    if (status === 'upToDate' || status === 'error' || status === 'unsupported') {
      checkRequested = false;
    }
  }

  async function onCheckUpdate() {
    const payload = typeof updater.status === 'function' ? updater.status() : null;
    const status = payload && payload.status;
    if (updateDialogInsteadOfCheck(status)) {
      if (typeof updater.openInstallDialog === 'function') updater.openInstallDialog();
      return;
    }
    watchUpdates();
    if (generalNodes) generalNodes.checkBtn.disabled = true;
    checkRequested = true;
    try {
      await window.dex.retryUpdateCheck();
    } catch (err) {
      checkRequested = false;
      if (!generalNodes || activeSettingsId !== GENERAL_NAV_ID) return;
      generalNodes.note.textContent = err instanceof Error ? err.message : '检查更新失败';
      generalNodes.note.hidden = false;
      generalNodes.note.classList.add('is-error');
      generalNodes.checkBtn.disabled = false;
    }
  }

  function showHostError(errorEl, message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  async function openHostData(kind, errorEl) {
    showHostError(errorEl, '');
    try {
      const result = await window.dex.openHostData(kind);
      if (activeSettingsId !== GENERAL_NAV_ID) return;
      if (result && result.ok) return;
      showHostError(errorEl, (result && result.message) || '无法打开目录');
    } catch (err) {
      if (activeSettingsId !== GENERAL_NAV_ID) return;
      showHostError(errorEl, err instanceof Error ? err.message : '无法打开目录');
    }
  }

  function hostPathRow(title, kind) {
    const row = document.createElement('div');
    row.className = 'settings-row settings-host-row';
    const copy = document.createElement('div');
    copy.className = 'settings-card-copy';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const error = document.createElement('p');
    error.className = 'settings-host-error';
    error.hidden = true;
    copy.append(heading, error);
    const control = document.createElement('div');
    control.className = 'settings-control settings-row-cluster';
    const value = document.createElement('span');
    value.className = 'settings-host-path';
    const open = secondaryButton('打开');
    open.addEventListener('click', () => {
      void openHostData(kind, error);
    });
    control.append(value, open);
    row.append(copy, control);
    return { row, value, error };
  }

  async function renderGeneralSettings() {
    settingsTitle.textContent = '通用设置';
    hidePluginSettingsChrome();
    settingsForm.replaceChildren();
    const about = settingsGroup('关于');
    const data = settingsGroup('本机数据');

    const nameRow = document.createElement('div');
    nameRow.className = 'settings-row';
    const nameCopy = document.createElement('div');
    nameCopy.className = 'settings-card-copy';
    const nameHeading = document.createElement('h3');
    nameHeading.textContent = '产品名称';
    nameCopy.appendChild(nameHeading);
    const nameControl = document.createElement('div');
    nameControl.className = 'settings-control';
    nameControl.appendChild(hostValue(PRODUCT_NAME));
    nameRow.append(nameCopy, nameControl);

    const versionRow = document.createElement('div');
    versionRow.className = 'settings-row settings-host-row';
    const versionCopy = document.createElement('div');
    versionCopy.className = 'settings-card-copy';
    const versionHeading = document.createElement('h3');
    versionHeading.textContent = '版本';
    versionCopy.appendChild(versionHeading);
    const versionControl = document.createElement('div');
    versionControl.className = 'settings-control settings-row-cluster';
    const versionValue = hostValue('');
    const checkBtn = secondaryButton('检查更新');
    const note = document.createElement('span');
    note.className = 'settings-inline-note';
    checkBtn.addEventListener('click', () => {
      void onCheckUpdate();
    });
    versionControl.append(versionValue, checkBtn, note);
    versionRow.append(versionCopy, versionControl);

    const userRow = document.createElement('div');
    userRow.className = 'settings-row';
    const userCopy = document.createElement('div');
    userCopy.className = 'settings-card-copy';
    const userHeading = document.createElement('h3');
    userHeading.textContent = '当前用户';
    const userHint = document.createElement('p');
    userHint.textContent = '本机操作系统账户';
    userCopy.append(userHeading, userHint);
    const userControl = document.createElement('div');
    userControl.className = 'settings-control';
    const userValue = hostValue('');
    userControl.appendChild(userValue);
    userRow.append(userCopy, userControl);

    const userData = hostPathRow('用户数据目录', 'userData');
    const installed = hostPathRow('已安装插件目录', 'installedPlugins');
    about.body.append(nameRow, versionRow, userRow);
    data.body.append(userData.row, installed.row);
    settingsForm.append(about.section, data.section);

    generalNodes = { note, checkBtn };
    watchUpdates();
    syncGeneralUpdate(typeof updater.status === 'function' ? updater.status() : null);

    try {
      const [info, name] = await Promise.all([
        window.dex.generalSettings(),
        window.dex.localUsername().catch(() => ''),
      ]);
      if (activeSettingsId !== GENERAL_NAV_ID) return;
      versionValue.textContent = info && typeof info.version === 'string' ? info.version : '';
      userValue.textContent = localUserLabel(name);
      userData.value.textContent = info && typeof info.userData === 'string' ? info.userData : '';
      installed.value.textContent = info && typeof info.installedPlugins === 'string' ? info.installedPlugins : '';
    } catch (err) {
      if (activeSettingsId !== GENERAL_NAV_ID) return;
      setStatus(err instanceof Error ? err.message : '无法读取通用设置', 'error');
    }
  }

  function appendReset(parent, field, plugin) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'settings-reset';
    reset.textContent = '恢复默认';
    reset.addEventListener('click', () => {
      restoreFieldDefault(field);
      renderSettingsForm(plugin);
      syncSaveButton();
    });
    parent.appendChild(reset);
  }

  function fieldGroups(fields) {
    const groups = [];
    const index = new Map();
    for (const field of fields) {
      const name = field.group || GENERAL_GROUP;
      let group = index.get(name);
      if (!group) {
        group = { name, fields: [] };
        index.set(name, group);
        groups.push(group);
      }
      group.fields.push(field);
    }
    return groups;
  }

  function renderSettingsForm(plugin) {
    settingsForm.replaceChildren();
    if (!settingsDraft || plugin.schemaError || plugin.fields.length === 0) return;
    for (const group of fieldGroups(plugin.fields)) {
      const section = document.createElement('section');
      section.className = 'settings-group';
      const heading = document.createElement('h2');
      heading.className = 'settings-group-title';
      heading.textContent = group.name;
      const body = document.createElement('div');
      body.className = 'settings-group-body';
      section.append(heading, body);
      for (const field of group.fields) {
        const row = document.createElement('div');
        row.className = 'settings-row';
        const copy = document.createElement('div');
        copy.className = 'settings-card-copy';
        const title = document.createElement('h3');
        title.textContent = field.title;
        copy.appendChild(title);
        if (field.description) {
          const description = document.createElement('p');
          description.textContent = field.description;
          copy.appendChild(description);
        }
        appendReset(copy, field, plugin);
        const control = document.createElement('div');
        control.className = 'settings-control';
        control.appendChild(renderFieldControl(field, plugin));
        row.append(copy, control);
        body.appendChild(row);
      }
      settingsForm.appendChild(section);
    }
    mountIcons(settingsForm);
  }

  function renderFieldControl(field, plugin) {
    if (field.type === 'boolean') return renderSwitch(field);
    if (field.type === 'select') return renderSelect(field);
    if (field.type === 'path') return renderPath(field);
    if (field.secret) return renderSecret(field, plugin);
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
      syncSaveButton();
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
      syncSaveButton();
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
        syncSaveButton();
      });
    } else {
      input.value = typeof settingsDraft.values[field.key] === 'string' ? settingsDraft.values[field.key] : '';
      input.addEventListener('input', () => {
        settingsDraft.values[field.key] = input.value;
        syncSaveButton();
      });
    }
    return input;
  }

  function renderSecret(field, plugin) {
    const mask = '••••••••';
    const wrap = document.createElement('div');
    wrap.className = 'settings-control';
    const input = document.createElement('input');
    input.className = 'settings-input';
    input.autocomplete = 'new-password';
    input.spellcheck = false;
    input.setAttribute('aria-label', field.title);
    const intent = settingsDraft.secrets[field.key] || { action: 'keep' };
    let revealed = false;
    let revealedKeep = null;
    const currentIntent = () => settingsDraft.secrets[field.key] || { action: 'keep' };
    const syncPlaceholder = () => {
      const current = currentIntent();
      const masked = field.secretSet === true && current.action === 'keep' && !revealed;
      input.placeholder = masked ? mask : '';
    };
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'settings-icon-btn';
    const eyeIcon = document.createElement('i');
    eye.appendChild(eyeIcon);
    const syncEye = () => {
      const current = currentIntent();
      const show = field.secretSet === true && current.action === 'keep';
      eye.hidden = !show;
      eyeIcon.dataset.lucide = revealed ? 'eye-off' : 'eye';
      eye.setAttribute('aria-label', revealed ? '隐藏密钥' : '查看密钥');
      eye.setAttribute('aria-pressed', revealed ? 'true' : 'false');
      mountIcons(eye);
    };
    const showPlainDraft = () => {
      revealed = false;
      revealedKeep = null;
      input.type = 'text';
      const current = currentIntent();
      input.value = current.action === 'set' ? current.value : '';
      syncPlaceholder();
      syncEye();
    };
    const showMasked = () => {
      revealed = false;
      revealedKeep = null;
      input.type = 'password';
      input.value = '';
      syncPlaceholder();
      syncEye();
    };
    if (intent.action === 'set') showPlainDraft();
    else showMasked();
    input.addEventListener('focus', () => {
      if (revealed) return;
      if (currentIntent().action === 'set') {
        input.type = 'text';
        return;
      }
      input.type = 'text';
      input.value = '';
    });
    input.addEventListener('blur', () => {
      if (revealed || currentIntent().action === 'set') return;
      showMasked();
    });
    input.addEventListener('input', () => {
      const current = currentIntent();
      if (revealedKeep !== null && input.value === revealedKeep && current.action === 'keep') {
        settingsDraft.secrets[field.key] = { action: 'keep' };
      } else if (input.value === '') {
        revealedKeep = null;
        revealed = false;
        if (current.action !== 'clear') settingsDraft.secrets[field.key] = { action: 'keep' };
      } else {
        revealedKeep = null;
        revealed = false;
        input.type = 'text';
        settingsDraft.secrets[field.key] = { action: 'set', value: input.value };
      }
      syncPlaceholder();
      syncEye();
      syncSaveButton();
    });
    eye.addEventListener('click', async () => {
      if (currentIntent().action !== 'keep' || field.secretSet !== true) return;
      if (revealed) {
        showMasked();
        return;
      }
      const result = await window.dex.revealPluginSecret(plugin.id, field.key);
      if (!result || result.ok !== true || typeof result.value !== 'string' || result.value === '') return;
      if (currentIntent().action !== 'keep') return;
      revealed = true;
      revealedKeep = result.value;
      input.type = 'text';
      input.value = result.value;
      syncPlaceholder();
      syncEye();
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'settings-text-btn';
    clear.textContent = '清除';
    clear.addEventListener('click', () => {
      settingsDraft.secrets[field.key] = { action: 'clear' };
      showMasked();
      syncSaveButton();
    });
    wrap.append(input, eye, clear);
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
      syncSaveButton();
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

  function catalogIds() {
    return settingsCatalog.map((item) => item.id);
  }

  async function selectSettings(id) {
    if (id === activeSettingsId) return;
    const plugin = id === GENERAL_NAV_ID ? null : settingsCatalog.find((item) => item.id === id);
    if (id !== GENERAL_NAV_ID && !plugin) return;
    if (activeSettingsId && !(await confirmDiscard())) return;
    if (id === GENERAL_NAV_ID) {
      activeSettingsId = GENERAL_NAV_ID;
      settingsDraft = null;
      settingsBaseline = '';
      renderSettingsNav();
      try {
        await renderGeneralSettings();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : '打开设置页失败', 'error');
      }
      return;
    }
    generalNodes = null;
    activeSettingsId = id;
    settingsDraft = draftFromPlugin(plugin);
    rememberBaseline();
    renderSettingsNav();
    try {
      await renderSettingsMain(plugin, true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '打开设置页失败', 'error');
    }
  }

  async function enterSettings(pluginId) {
    if (shell.settingsMode) {
      if (typeof pluginId === 'string') await selectSettings(preferredSettingsId(pluginId, catalogIds()));
      return;
    }
    returnPluginId = shell.activeId;
    shell.settingsMode = true;
    settingsSearch.value = '';
    plugins.suspend();
    settingsScreen.hidden = false;
    setStatus('');
    await reloadSettingsCatalog();
    if (!shell.settingsMode) return;
    await selectSettings(preferredSettingsId(pluginId, catalogIds()));
  }

  function leaveSettings(options = {}) {
    const backTo = returnPluginId;
    shell.settingsMode = false;
    activeSettingsId = null;
    generalNodes = null;
    settingsDraft = null;
    settingsBaseline = '';
    settingsScreen.hidden = true;
    settingsEntryHost.replaceChildren();
    // 切到插件页时工作区仍应保持挂起，不能把刚才的插件页面露出来。
    if (options.resume !== false) plugins.resume(backTo);
  }

  function onSettingsSearch() {
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
      rememberBaseline();
      await renderSettingsMain(fresh, false);
      reloadSettingsWebview();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      savingSettings = false;
      syncSaveButton();
    }
  }

  function dismissSurface() {
    settingsScreen.hidden = true;
    settingsEntryHost.replaceChildren();
  }

  async function onPluginsChanged() {
    await reloadSettingsCatalog();
    if (!activeSettingsId || activeSettingsId === GENERAL_NAV_ID) return;
    if (settingsCatalog.some((plugin) => plugin.id === activeSettingsId)) return;
    activeSettingsId = null;
    settingsDraft = null;
    settingsBaseline = '';
    await selectSettings(GENERAL_NAV_ID);
  }

  settingsSearch.addEventListener('input', () => {
    onSettingsSearch();
  });
  settingsSave.addEventListener('click', () => {
    void saveActiveSettings();
  });
  discardStay.addEventListener('click', () => {
    finishDiscard(false);
  });
  discardConfirm.addEventListener('click', () => {
    finishDiscard(true);
  });
  discardDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishDiscard(false);
  });

  return { onPluginsChanged, dismissSurface, enterSettings, leaveSettings, confirmDiscard };
}
