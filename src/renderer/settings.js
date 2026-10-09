export function mountSettings({ shell, setStatus, plugins }) {
  const settingsNav = document.getElementById('settings-nav');
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

  let settingsCatalog = [];
  let activeSettingsId = null;
  let settingsDraft = null;
  let returnPluginId = null;
  let savingSettings = false;

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
    if (shell.settingsMode) return;
    returnPluginId = shell.activeId;
    shell.settingsMode = true;
    settingsSearch.value = '';
    plugins.suspend();
    settingsNav.hidden = false;
    settingsScreen.hidden = false;
    setStatus('');
    await reloadSettingsCatalog();
    if (!shell.settingsMode) return;
    const first = visibleSettings()[0];
    if (first) await selectSettings(first.id);
    else clearSettingsMain();
  }

  function leaveSettings() {
    const backTo = returnPluginId;
    shell.settingsMode = false;
    activeSettingsId = null;
    settingsDraft = null;
    settingsNav.hidden = true;
    settingsScreen.hidden = true;
    settingsEntryHost.replaceChildren();
    plugins.resume(backTo);
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

  function dismissSurface() {
    settingsScreen.hidden = true;
    settingsEntryHost.replaceChildren();
  }

  async function onPluginsChanged() {
    await reloadSettingsCatalog();
    if (activeSettingsId && !settingsCatalog.some((plugin) => plugin.id === activeSettingsId)) {
      activeSettingsId = null;
      settingsDraft = null;
      const first = visibleSettings()[0];
      if (first) await selectSettings(first.id);
      else clearSettingsMain();
    }
  }

  settingsSearch.addEventListener('input', () => {
    onSettingsSearch();
  });
  settingsSave.addEventListener('click', () => {
    void saveActiveSettings();
  });

  return { onPluginsChanged, dismissSurface, enterSettings, leaveSettings };
}
