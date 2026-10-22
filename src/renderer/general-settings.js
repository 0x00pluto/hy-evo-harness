/** 不是合法插件 id（插件 id 只允许小写、数字和连字符）。 */
export const GENERAL_NAV_ID = '@general';

export const PRODUCT_NAME = 'Dex Buddy';

export const LOCAL_USER_LABEL = '本地用户';

const GENERAL_SEARCH_LABELS = [
  '通用设置',
  '产品名称',
  '版本',
  '当前用户',
  '用户数据目录',
  '已安装插件目录',
];

/**
 * @param {string | undefined} pluginId
 * @param {string[]} catalogIds
 */
export function preferredSettingsId(pluginId, catalogIds) {
  if (typeof pluginId === 'string' && Array.isArray(catalogIds) && catalogIds.includes(pluginId)) {
    return pluginId;
  }
  return GENERAL_NAV_ID;
}

/** @param {string | null | undefined} query */
export function generalNavMatches(query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return GENERAL_SEARCH_LABELS.some((label) => label.toLowerCase().includes(needle));
}

/** @param {string | null | undefined} name */
export function localUserLabel(name) {
  const text = typeof name === 'string' ? name.trim() : '';
  return text || LOCAL_USER_LABEL;
}

/**
 * @param {UpdateStatus | string | undefined} status
 * @param {string | undefined} [errorMessage]
 */
export function updateCheckNote(status, errorMessage) {
  if (status === 'checking') return '正在检查…';
  if (status === 'upToDate') return '已是最新版本';
  if (status === 'unsupported') return '当前环境不检查更新';
  if (status === 'error') {
    return typeof errorMessage === 'string' && errorMessage.trim() !== '' ? errorMessage : '检查更新失败';
  }
  return '';
}

/** @param {UpdateStatus | string | undefined} status */
export function updateDialogInsteadOfCheck(status) {
  return status === 'readyToInstall' || status === 'downloading' || status === 'installing';
}
