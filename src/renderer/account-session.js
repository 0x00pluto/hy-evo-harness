/** 网关会话摘要文案与图标轨用户弹出层（三态一按钮）。 */

export const POINTS_NAV_ID = '@points';

const POINTS_SEARCH_LABELS = ['积分', '余额', '同步', '买断', '已购', '商城', '购买积分'];

/**
 * @param {string | null | undefined} query
 */
export function pointsNavMatches(query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  return POINTS_SEARCH_LABELS.some((label) => label.toLowerCase().includes(needle));
}

/**
 * @param {number | null | undefined} balance
 * @param {string | null | undefined} [_currency]
 */
export function balanceLabel(balance, _currency) {
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return '积分未知';
  return `${balance} 积分`;
}

/**
 * 齿轮 / 轨顶部摘要：未登录 | 登录中 | 脱敏手机号。
 * @param {GatewaySessionView | null | undefined} view
 */
export function accountHeadline(view) {
  if (!view) return '未登录';
  if (view.signedIn) {
    const phone =
      typeof view.phoneMasked === 'string' && view.phoneMasked.trim() !== ''
        ? view.phoneMasked.trim()
        : '已登录';
    return phone;
  }
  if (isLoginPending(view)) return '登录中';
  return '未登录';
}

/**
 * @param {GatewaySessionView | null | undefined} view
 * @returns {Array<{ pluginId: string; displayName: string }>}
 */
export function buyoutItems(view) {
  if (!view || !view.signedIn || !Array.isArray(view.buyouts)) return [];
  return view.buyouts
    .filter((item) => item && typeof item.pluginId === 'string' && item.pluginId.trim() !== '')
    .map((item) => ({
      pluginId: item.pluginId.trim(),
      displayName:
        typeof item.displayName === 'string' && item.displayName.trim() !== ''
          ? item.displayName.trim()
          : item.pluginId.trim(),
    }));
}

/**
 * @param {{ pluginId: string; displayName: string }} item
 * @param {Array<{ manifestId?: string; id?: string; displayName?: string }> | null | undefined} [localPlugins]
 */
export function buyoutLabel(item, localPlugins) {
  const pluginId = item.pluginId;
  let name = typeof item.displayName === 'string' ? item.displayName.trim() : '';
  if (!name || name === pluginId) {
    const match = Array.isArray(localPlugins)
      ? localPlugins.find((plugin) => plugin.manifestId === pluginId || plugin.id === pluginId)
      : null;
    const localName = match && typeof match.displayName === 'string' ? match.displayName.trim() : '';
    if (localName) name = localName;
  }
  if (!name || name === pluginId) return pluginId;
  return `${name} (${pluginId})`;
}

/**
 * @param {GatewaySessionView | null | undefined} view
 */
export function isLoginPending(view) {
  if (!view || !view.login || view.signedIn) return false;
  const phase = view.login.phase;
  return (
    phase === 'opening_browser' ||
    phase === 'waiting_callback' ||
    phase === 'device_pending' ||
    phase === 'exchanging'
  );
}

/**
 * 图标轨用户弹出层（仅已登录时使用；未登录点轨直接登录）。
 * @param {HTMLElement} root
 * @param {{
 *   view: GatewaySessionView;
 *   onLogout: () => void;
 *   onContinue?: () => void;
 * }} opts
 */
export function renderAccountPanel(root, opts) {
  const { view } = opts;
  root.replaceChildren();
  root.classList.add('account-panel', 'account-panel-popover');

  if (view.signedIn) {
    const phone = document.createElement('div');
    phone.className = 'account-phone';
    phone.textContent = accountHeadline(view);
    root.appendChild(phone);
    root.appendChild(actionButton('退出', opts.onLogout, 'account-action account-action-danger'));
    return;
  }

  if (isLoginPending(view) && typeof opts.onContinue === 'function') {
    const status = document.createElement('div');
    status.className = 'account-status';
    status.textContent = '登录中';
    root.appendChild(status);
    root.appendChild(actionButton('继续登录', opts.onContinue, 'account-action'));
    return;
  }

  const status = document.createElement('div');
  status.className = 'account-status';
  status.textContent = '未登录';
  root.appendChild(status);
}

/**
 * @param {string} label
 * @param {() => void} onClick
 * @param {string} className
 */
function actionButton(label, onClick, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}
