import { byId } from './dom.js';
import { mountIcons } from './icons.js';

/** @type {Record<SpendBlockedReason, { title: string; confirm: string; icon: string }>} */
const COPY = {
  NOT_ENTITLED: {
    title: '需要购买插件',
    confirm: '去购买',
    icon: 'puzzle',
  },
  UNAUTHORIZED: {
    title: '需要登录',
    confirm: '去登录',
    icon: 'circle-user',
  },
  INSUFFICIENT_CREDITS: {
    title: '积分不够',
    confirm: '购买积分',
    icon: 'coins',
  },
};

/**
 * @param {SpendBlockedReason} reason
 * @param {string} name
 */
function bodyText(reason, name) {
  if (reason === 'NOT_ENTITLED') {
    return name ? `使用「${name}」前请先购买。` : '使用前请先购买。';
  }
  if (reason === 'UNAUTHORIZED') return '使用前请先登录。';
  return '使用前请先购买积分。';
}

/**
 * @param {{
 *   pluginName?: (pluginId: string) => string | null | undefined;
 *   onOpen?: () => void;
 *   onClose?: () => void;
 * }} [opts]
 */
export function mountSpendGate(opts = {}) {
  const dialog = byId('spend-gate-dialog', 'dialog');
  const iconHost = byId('spend-gate-icon', 'span');
  const title = byId('spend-gate-title', 'h2');
  const body = byId('spend-gate-body', 'p');
  const later = byId('spend-gate-later', 'button');
  const confirm = byId('spend-gate-confirm', 'button');

  /** @type {SpendBlockedPayload | null} */
  let current = null;

  /** @param {string} pluginId */
  function resolveName(pluginId) {
    if (typeof opts.pluginName !== 'function') return '';
    const raw = opts.pluginName(pluginId);
    return typeof raw === 'string' ? raw.trim() : '';
  }

  /** @param {string} icon */
  function setIcon(icon) {
    iconHost.replaceChildren();
    const mark = document.createElement('i');
    mark.setAttribute('data-lucide', icon);
    mark.setAttribute('aria-hidden', 'true');
    iconHost.append(mark);
    mountIcons(dialog);
  }

  /** @param {SpendBlockedPayload} payload */
  function show(payload) {
    const copy = COPY[payload.reason];
    if (!copy) return;
    if (
      dialog.open
      && current
      && current.pluginId === payload.pluginId
      && current.reason === payload.reason
    ) {
      return;
    }
    current = payload;
    title.textContent = copy.title;
    body.textContent = bodyText(payload.reason, resolveName(payload.pluginId));
    confirm.textContent = copy.confirm;
    setIcon(copy.icon);
    if (!dialog.open) {
      // 原生 webview 会盖住宿主 dialog，打开前先让壳把当前 guest 藏起。
      if (typeof opts.onOpen === 'function') opts.onOpen();
      dialog.showModal();
    }
  }

  later.addEventListener('click', () => {
    dialog.close();
  });

  confirm.addEventListener('click', () => {
    const payload = current;
    dialog.close();
    if (!payload) return;
    if (payload.reason === 'UNAUTHORIZED') {
      void window.dex.startGatewayLogin();
      return;
    }
    void window.dex.openGatewayShop();
  });

  dialog.addEventListener('close', () => {
    current = null;
    if (typeof opts.onClose === 'function') opts.onClose();
  });

  if (window.dex.onSpendBlocked) window.dex.onSpendBlocked(show);
}
