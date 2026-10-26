import {
  POINTS_NAV_ID,
  accountHeadline,
  balanceLabel,
  buyoutItems,
  buyoutLabel,
  isLoginPending,
  pointsNavMatches,
} from './account-session.js';
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
import { byId } from './dom.js';

const GENERAL_GROUP = '通用配置';
const SETTINGS_SOURCE = {
  bundled: '示例',
  dev: '开发',
  local: '本地',
  installed: '已安装',
};

/** @param {PluginSource | string} source */
function settingsSourceLabel(source) {
  if (source === 'bundled' || source === 'dev' || source === 'local' || source === 'installed') {
    return SETTINGS_SOURCE[source];
  }
  return '内置';
}

/**
 * @param {{
 *   shell: { plugins: PluginSummary[]; activeId: string | null; settingsMode: boolean };
 *   setStatus: (message: string, kind?: string) => void;
 *   plugins: {
 *     refresh: (list?: PluginSummary[]) => Promise<void>;
 *     suspend: () => void;
 *     resume: (pluginId?: string | null) => void;
 *   };
 *   updater?: UpdaterBridge;
 * }} opts
 */
export function mountSettings({ shell, setStatus, plugins, updater = /** @type {UpdaterBridge} */ ({
  status() { return null; },
  onStatus() { return () => {}; },
  openInstallDialog() {},
}) }) {
  const settingsSearch = byId('settings-search', 'input');
  const settingsList = byId('settings-list', 'div');
  const settingsScreen = byId('settings-screen', 'section');
  const settingsTitle = byId('settings-plugin-title', 'h1');
  const settingsSchemaError = byId('settings-schema-error', 'p');
  const settingsForm = byId('settings-form', 'div');
  const settingsActions = byId('settings-actions', 'div');
  const settingsSave = byId('settings-save', 'button');
  const settingsEmpty = byId('settings-empty', 'p');
  const settingsEntryHost = byId('settings-entry-host', 'div');
  const discardDialog = byId('settings-discard-dialog', 'dialog');
  const discardStay = byId('settings-discard-stay', 'button');
  const discardConfirm = byId('settings-discard-confirm', 'button');

  /** @type {SettingsPluginView[]} */
  let settingsCatalog = [];
  /** @type {string | null} */
  let activeSettingsId = null;
  /** @type {{ values: Record<string, string | number | boolean>; secrets: Record<string, { action: 'keep' | 'clear' | 'set'; value?: string }> } | null} */
  let settingsDraft = null;
  let settingsBaseline = '';
  /** @type {string | null} */
  let returnPluginId = null;
  let savingSettings = false;
  /** @type {((allowed: boolean) => void) | null} */
  let discardResolver = null;
  /** @type {{ note: HTMLSpanElement; checkBtn: HTMLButtonElement } | null} */
  let generalNodes = null;
  /** @type {{
   *   accountStatus: HTMLElement;
   *   accountLead: HTMLDivElement;
   *   accountActions: HTMLDivElement;
   * } | null} */
  let accountNodes = null;
  /** @type {{
   *   pointsValue: HTMLSpanElement;
   *   pointsLead: HTMLDivElement;
   *   pointsSync: HTMLButtonElement;
   *   pointsActions: HTMLDivElement;
   *   buyoutBody: HTMLElement;
   *   buyoutSection: HTMLElement;
   * } | null} */
  let pointsNodes = null;
  let checkRequested = false;
  /** @type {(() => void) | null} */
  let stopUpdateWatch = null;
  /** @type {(() => void) | null} */
  let stopSessionWatch = null;
  /** @type {GatewaySessionView | null} */
  let accountView = null;

  function activeDraft() {
    if (!settingsDraft) throw new Error('settings draft missing');
    return settingsDraft;
  }

  function settingsQueryText() {
    return settingsSearch.value.trim().toLowerCase();
  }

  /**
   * @param {SettingsPluginView} plugin
   * @param {string} query
   */
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

  /** @param {SettingsPluginView} plugin */
  function draftFromPlugin(plugin) {
    /** @type {Record<string, string | number | boolean>} */
    const values = {};
    /** @type {Record<string, { action: 'keep' | 'clear' | 'set'; value?: string }>} */
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

  /**
   * @param {SettingsPluginView} plugin
   * @param {{ values: Record<string, string | number | boolean>; secrets: Record<string, { action: 'keep' | 'clear' | 'set'; value?: string }> }} draft
   */
  function payloadFromDraft(plugin, draft) {
    /** @type {Record<string, string | number | boolean | null>} */
    const values = {};
    /** @type {Record<string, { action: 'keep' | 'clear' | 'set'; value?: string }>} */
    const secrets = {};
    for (const field of plugin.fields) {
      if (field.secret) {
        const intent = draft.secrets[field.key] || { action: 'keep' };
        if (intent.action === 'set') secrets[field.key] = { action: 'set', value: intent.value || '' };
        else if (intent.action === 'clear') secrets[field.key] = { action: 'clear' };
        else secrets[field.key] = { action: 'keep' };
        continue;
      }
      /** @type {string | number | boolean | null} */
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

  /** @param {boolean} allowed */
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

  /** @param {SettingsFieldView} field */
  function restoreFieldDefault(field) {
    const draft = activeDraft();
    if (field.secret) {
      const next = typeof field.default === 'string' ? field.default : '';
      draft.secrets[field.key] = next === '' ? { action: 'clear' } : { action: 'set', value: next };
      return;
    }
    if (field.type === 'number') {
      draft.values[field.key] = typeof field.default === 'number' ? field.default : '';
      return;
    }
    if (field.type === 'boolean') {
      draft.values[field.key] = field.default === true;
      return;
    }
    draft.values[field.key] = typeof field.default === 'string' ? field.default : '';
  }

  function renderSettingsNav() {
    settingsList.replaceChildren();
    const query = settingsQueryText();
    const showGeneral = generalNavMatches(query);
    const showPoints = pointsNavMatches(query);
    const visible = visibleSettings();
    if (!showGeneral && !showPoints && visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-nav';
      empty.textContent = '没有结果';
      settingsList.appendChild(empty);
      return;
    }
    if (showGeneral || showPoints) {
      settingsList.appendChild(navSectionTitle('个人设置'));
      if (showGeneral) settingsList.appendChild(generalNavButton());
      if (showPoints) settingsList.appendChild(pointsNavButton());
    }
    if (visible.length > 0) {
      settingsList.appendChild(navSectionTitle('插件'));
      for (const plugin of visible) settingsList.appendChild(pluginNavButton(plugin));
    }
    mountIcons(settingsList);
  }

  /** @param {string} text */
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

  function pointsNavButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item plugin-row';
    const selected = activeSettingsId === POINTS_NAV_ID;
    if (selected) button.classList.add('active');
    button.setAttribute('aria-current', selected ? 'true' : 'false');
    const copy = document.createElement('span');
    copy.className = 'plugin-row-copy';
    const mark = document.createElement('span');
    mark.className = 'plugin-mark plugin-mark-nav';
    const icon = document.createElement('i');
    icon.dataset.lucide = 'coins';
    mark.appendChild(icon);
    const title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = '积分';
    copy.append(mark, title);
    button.appendChild(copy);
    button.addEventListener('click', () => {
      void selectSettings(POINTS_NAV_ID);
    });
    return button;
  }

  /** @param {SettingsPluginView} plugin */
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

  /** @param {SettingsPluginView} plugin */
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

  /** @param {string} name */
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

  /** @param {string} text */
  function hostValue(text) {
    const value = document.createElement('span');
    value.className = 'settings-host-value';
    value.textContent = text;
    return value;
  }

  /** @param {string} label */
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

  /** @param {UpdaterStatusPayload | null | undefined} payload */
  function syncGeneralUpdate(payload) {
    if (!generalNodes || activeSettingsId !== GENERAL_NAV_ID) return;
    const status = payload && payload.status;
    const noteText = updateCheckNote(status, payload && payload.errorMessage);
    generalNodes.note.hidden = noteText === '';
    generalNodes.note.textContent = noteText;
    generalNodes.note.classList.toggle('is-error', status === 'error');
    generalNodes.checkBtn.disabled = status === 'checking';
  }

  /** @param {UpdaterStatusPayload} payload */
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

  /**
   * @param {HTMLElement} errorEl
   * @param {string} message
   */
  function showHostError(errorEl, message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  /**
   * @param {string} kind
   * @param {HTMLElement} errorEl
   */
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

  /**
   * @param {string} title
   * @param {string} kind
   */
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

  function stopAccountWatch() {
    if (stopSessionWatch) {
      stopSessionWatch();
      stopSessionWatch = null;
    }
  }

  /**
   * @param {() => Promise<{ ok: boolean; message?: string }>} action
   */
  async function runAccountAction(action) {
    try {
      const result = await action();
      if (result && result.ok === false && result.message) setStatus(result.message, 'error');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '操作失败', 'error');
    }
  }

  /** @returns {GatewaySessionView} */
  function currentAccountView() {
    return (
      accountView || {
        signedIn: false,
        phoneMasked: null,
        balance: null,
        currency: null,
        buyouts: [],
        login: { phase: /** @type {GatewayLoginPhase} */ ('idle') },
      }
    );
  }

  function syncAccountSections() {
    if (accountNodes && activeSettingsId === GENERAL_NAV_ID) {
      const view = currentAccountView();
      const { accountStatus, accountLead, accountActions } = accountNodes;
      accountLead.replaceChildren(accountStatus);
      accountActions.replaceChildren();
      accountStatus.textContent = accountHeadline(view);

      if (view.signedIn) {
        const logout = secondaryButton('退出');
        logout.classList.add('settings-text-btn-danger');
        logout.addEventListener('click', () => {
          void runAccountAction(() => window.dex.logoutGateway());
        });
        accountActions.appendChild(logout);
      } else if (isLoginPending(view)) {
        const cont = secondaryButton('继续登录');
        cont.addEventListener('click', () => {
          void runAccountAction(() => window.dex.reopenGatewayLogin());
        });
        accountLead.appendChild(cont);
      } else {
        const login = secondaryButton('登录');
        login.addEventListener('click', () => {
          void runAccountAction(() => window.dex.startGatewayLogin());
        });
        accountLead.appendChild(login);
      }
    }

    if (pointsNodes && activeSettingsId === POINTS_NAV_ID) {
      const view = currentAccountView();
      const { pointsValue, pointsLead, pointsSync, pointsActions, buyoutBody, buyoutSection } = pointsNodes;
      pointsLead.replaceChildren(pointsValue);
      pointsActions.replaceChildren();
      const shop = secondaryButton('购买积分');
      shop.addEventListener('click', () => {
        void runAccountAction(() => window.dex.openGatewayShop());
      });
      if (view.signedIn) {
        pointsValue.textContent = balanceLabel(view.balance);
        pointsSync.hidden = false;
        pointsSync.disabled = false;
        pointsActions.appendChild(shop);
        buyoutSection.hidden = false;
        const items = buyoutItems(view);
        buyoutBody.replaceChildren();
        if (items.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'settings-buyout-empty';
          empty.textContent = '还没有已购插件';
          buyoutBody.appendChild(empty);
        } else {
          for (const item of items) {
            const row = document.createElement('div');
            row.className = 'settings-row';
            const copy = document.createElement('div');
            copy.className = 'settings-card-copy';
            const heading = document.createElement('h3');
            heading.textContent = buyoutLabel(item, shell.plugins);
            copy.appendChild(heading);
            row.appendChild(copy);
            buyoutBody.appendChild(row);
          }
        }
      } else if (isLoginPending(view)) {
        pointsValue.textContent = '登录中';
        pointsSync.hidden = true;
        const cont = secondaryButton('继续登录');
        cont.addEventListener('click', () => {
          void runAccountAction(() => window.dex.reopenGatewayLogin());
        });
        pointsLead.appendChild(cont);
        pointsActions.appendChild(shop);
        buyoutSection.hidden = true;
      } else {
        pointsValue.textContent = '未登录';
        pointsSync.hidden = true;
        const login = secondaryButton('登录');
        login.addEventListener('click', () => {
          void runAccountAction(() => window.dex.startGatewayLogin());
        });
        pointsLead.appendChild(login);
        pointsActions.appendChild(shop);
        buyoutSection.hidden = true;
      }
    }
  }

  /**
   * @param {{ refreshPoints?: boolean }} [options]
   */
  function watchAccountSession(options) {
    stopAccountWatch();
    if (!window.dex.onGatewaySession) return;
    stopSessionWatch = window.dex.onGatewaySession((/** @type {GatewaySessionView} */ view) => {
      accountView = view;
      syncAccountSections();
    });
    void window.dex
      .gatewaySession()
      .then((/** @type {GatewaySessionView} */ view) => {
        accountView = view;
        syncAccountSections();
        if (!options || !options.refreshPoints || !view.signedIn) return;
        if (activeSettingsId !== POINTS_NAV_ID) return;
        void runAccountAction(() => window.dex.refreshGatewaySession());
      })
      .catch(() => {});
  }

  async function renderGeneralSettings() {
    stopAccountWatch();
    accountNodes = null;
    pointsNodes = null;
    settingsTitle.textContent = '通用设置';
    hidePluginSettingsChrome();
    settingsForm.replaceChildren();

    const account = settingsGroup('账号');
    const about = settingsGroup('关于');
    const data = settingsGroup('本机数据');

    const accountRow = document.createElement('div');
    accountRow.className = 'settings-row settings-host-row';
    const accountCopy = document.createElement('div');
    accountCopy.className = 'settings-card-copy';
    const accountLead = document.createElement('div');
    accountLead.className = 'settings-account-lead';
    const accountStatus = document.createElement('h3');
    accountStatus.textContent = '未登录';
    accountLead.appendChild(accountStatus);
    accountCopy.appendChild(accountLead);
    const accountControl = document.createElement('div');
    accountControl.className = 'settings-control settings-row-cluster';
    const accountActions = document.createElement('div');
    accountActions.className = 'settings-account-actions';
    accountControl.appendChild(accountActions);
    accountRow.append(accountCopy, accountControl);
    account.body.appendChild(accountRow);

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
    settingsForm.append(account.section, about.section, data.section);

    generalNodes = { note, checkBtn };
    accountNodes = { accountStatus, accountLead, accountActions };
    watchUpdates();
    watchAccountSession();
    syncAccountSections();
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

  async function renderPointsSettings() {
    stopAccountWatch();
    accountNodes = null;
    pointsNodes = null;
    generalNodes = null;
    settingsTitle.textContent = '积分';
    hidePluginSettingsChrome();
    settingsForm.replaceChildren();

    const points = settingsGroup('积分');
    const pointsRow = document.createElement('div');
    pointsRow.className = 'settings-row settings-host-row';
    const pointsCopy = document.createElement('div');
    pointsCopy.className = 'settings-card-copy';
    const pointsHeading = document.createElement('h3');
    pointsHeading.textContent = '当前积分';
    const pointsLead = document.createElement('div');
    pointsLead.className = 'settings-account-lead';
    const pointsValue = hostValue('未登录');
    pointsLead.appendChild(pointsValue);
    pointsCopy.append(pointsHeading, pointsLead);
    const pointsControl = document.createElement('div');
    pointsControl.className = 'settings-control settings-row-cluster';
    const pointsSync = secondaryButton('重新同步');
    pointsSync.addEventListener('click', () => {
      void runAccountAction(() => window.dex.refreshGatewaySession());
    });
    const pointsActions = document.createElement('div');
    pointsActions.className = 'settings-account-actions';
    pointsControl.append(pointsSync, pointsActions);
    pointsRow.append(pointsCopy, pointsControl);
    points.body.appendChild(pointsRow);

    const buyouts = settingsGroup('已购插件');
    buyouts.section.hidden = true;
    settingsForm.append(points.section, buyouts.section);

    pointsNodes = {
      pointsValue,
      pointsLead,
      pointsSync,
      pointsActions,
      buyoutBody: buyouts.body,
      buyoutSection: buyouts.section,
    };
    watchAccountSession({ refreshPoints: true });
    syncAccountSections();
  }

  /**
   * @param {HTMLElement} parent
   * @param {SettingsFieldView} field
   * @param {SettingsPluginView} plugin
   */
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

  /** @param {SettingsFieldView[]} fields */
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

  /** @param {SettingsPluginView} plugin */
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

  /**
   * @param {SettingsFieldView} field
   * @param {SettingsPluginView} plugin
   */
  function renderFieldControl(field, plugin) {
    if (field.type === 'boolean') return renderSwitch(field);
    if (field.type === 'select') return renderSelect(field);
    if (field.type === 'path') return renderPath(field);
    if (field.secret) return renderSecret(field, plugin);
    return renderText(field, field.type === 'number' ? 'number' : 'text');
  }

  /** @param {SettingsFieldView} field */
  function renderSwitch(field) {
    const draft = activeDraft();
    const label = document.createElement('label');
    label.className = 'settings-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = draft.values[field.key] === true;
    input.setAttribute('aria-label', field.title);
    input.addEventListener('change', () => {
      activeDraft().values[field.key] = input.checked;
      syncSaveButton();
    });
    const track = document.createElement('span');
    label.append(input, track);
    return label;
  }

  /** @param {SettingsFieldView} field */
  function renderSelect(field) {
    const draft = activeDraft();
    const select = document.createElement('select');
    select.className = 'settings-select';
    select.setAttribute('aria-label', field.title);
    for (const option of field.options || []) {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = option;
      select.appendChild(item);
    }
    const selected = draft.values[field.key];
    select.value = typeof selected === 'string' ? selected : '';
    select.addEventListener('change', () => {
      activeDraft().values[field.key] = select.value;
      syncSaveButton();
    });
    return select;
  }

  /**
   * @param {SettingsFieldView} field
   * @param {string} type
   */
  function renderText(field, type) {
    const draft = activeDraft();
    const input = document.createElement('input');
    input.className = 'settings-input';
    input.type = type;
    input.setAttribute('aria-label', field.title);
    if (type === 'number') {
      const current = draft.values[field.key];
      input.value = typeof current === 'number' && Number.isFinite(current) ? String(current) : '';
      input.addEventListener('input', () => {
        activeDraft().values[field.key] = input.value === '' ? '' : input.valueAsNumber;
        syncSaveButton();
      });
    } else {
      const current = draft.values[field.key];
      input.value = typeof current === 'string' ? current : '';
      input.addEventListener('input', () => {
        activeDraft().values[field.key] = input.value;
        syncSaveButton();
      });
    }
    return input;
  }

  /**
   * @param {SettingsFieldView} field
   * @param {SettingsPluginView} plugin
   */
  function renderSecret(field, plugin) {
    const mask = '••••••••';
    const wrap = document.createElement('div');
    wrap.className = 'settings-control';
    const input = document.createElement('input');
    input.className = 'settings-input';
    input.autocomplete = 'new-password';
    input.spellcheck = false;
    input.setAttribute('aria-label', field.title);
    const intent = activeDraft().secrets[field.key] || { action: 'keep' };
    let revealed = false;
    /** @type {string | null} */
    let revealedKeep = null;
    const currentIntent = () => activeDraft().secrets[field.key] || { action: 'keep' };
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
      input.value = current.action === 'set' ? (current.value || '') : '';
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
        activeDraft().secrets[field.key] = { action: 'keep' };
      } else if (input.value === '') {
        revealedKeep = null;
        revealed = false;
        if (current.action !== 'clear') activeDraft().secrets[field.key] = { action: 'keep' };
      } else {
        revealedKeep = null;
        revealed = false;
        input.type = 'text';
        activeDraft().secrets[field.key] = { action: 'set', value: input.value };
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
      activeDraft().secrets[field.key] = { action: 'clear' };
      showMasked();
      syncSaveButton();
    });
    wrap.append(input, eye, clear);
    return wrap;
  }

  /** @param {SettingsFieldView} field */
  function renderPath(field) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-control';
    const value = document.createElement('span');
    value.className = 'settings-path-value';
    const raw = activeDraft().values[field.key];
    const current = typeof raw === 'string' ? raw : '';
    value.textContent = current || '未选择';
    value.title = current;
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'settings-text-btn path-change';
    change.textContent = '更改';
    change.addEventListener('click', async () => {
      const picked = await window.dex.pickDirectory();
      if (!picked || picked.cancelled || !picked.path) return;
      activeDraft().values[field.key] = picked.path;
      value.textContent = picked.path;
      value.title = picked.path;
      syncSaveButton();
    });
    wrap.append(value, change);
    return wrap;
  }

  /**
   * @param {SettingsPluginView} plugin
   * @param {boolean} mountEntry
   */
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

  /** @param {SettingsPluginView} plugin */
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
    const webview = /** @type {ElectronWebviewElement | null} */ (settingsEntryHost.querySelector('webview'));
    if (webview && typeof webview.reload === 'function') webview.reload();
  }

  async function reloadSettingsCatalog() {
    settingsCatalog = await window.dex.settingsCatalog();
    renderSettingsNav();
  }

  function catalogIds() {
    return settingsCatalog.map((item) => item.id);
  }

  /** @param {string | null | undefined} id */
  function isHostSettingsId(id) {
    return id === GENERAL_NAV_ID || id === POINTS_NAV_ID;
  }

  /** @param {string} id */
  async function selectSettings(id) {
    if (id === activeSettingsId) return;
    const plugin = isHostSettingsId(id) ? null : settingsCatalog.find((item) => item.id === id);
    if (!isHostSettingsId(id) && !plugin) return;
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
    if (id === POINTS_NAV_ID) {
      activeSettingsId = POINTS_NAV_ID;
      settingsDraft = null;
      settingsBaseline = '';
      renderSettingsNav();
      try {
        await renderPointsSettings();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : '打开设置页失败', 'error');
      }
      return;
    }
    if (!plugin) return;
    stopAccountWatch();
    accountNodes = null;
    pointsNodes = null;
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

  /** @param {string} [pluginId] */
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

  /** @param {{ resume?: boolean }} [options] */
  function leaveSettings(options = {}) {
    const backTo = returnPluginId;
    shell.settingsMode = false;
    activeSettingsId = null;
    generalNodes = null;
    accountNodes = null;
    pointsNodes = null;
    stopAccountWatch();
    accountView = null;
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
    if (!activeSettingsId || isHostSettingsId(activeSettingsId)) return;
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
