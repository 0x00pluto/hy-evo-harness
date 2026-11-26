/**
 * 工作台共用悬停提示：fixed 挂 body，对齐目录 tip / 图标轨更新钮。
 * 不用 absolute 塞进 overflow 容器（见 docs/faqs/how-to-prevent-popup-clipping.md）。
 */

export const RAIL_UPDATE_TIP_TEXT = '有可用更新';

/** 插件页换详情/市场时只清目录 tip；勿含 `.hover-tip`，否则会摘掉轨上常驻 tip。 */
export const FOLDER_HOVER_TIP_CLEAR_SELECTOR = '.plugin-folder-tip';

/** @type {Set<HTMLElement>} */
const openTips = new Set();

let tipSeq = 0;
let escapeBound = false;

/**
 * @typedef {{ top: number, left: number, width: number, height: number }} TipAnchorRect
 * @typedef {{ width: number, height: number }} TipSize
 * @typedef {{ width: number, height: number }} TipViewport
 * @typedef {'top' | 'right'} HoverTipPlacement
 */

/**
 * @param {TipAnchorRect} anchor
 * @param {TipSize} tipSize
 * @param {TipViewport} viewport
 * @param {HoverTipPlacement} placement
 * @returns {{ top: number, left: number }}
 */
export function computeHoverTipPosition(anchor, tipSize, viewport, placement) {
  const gap = 8;
  const margin = 8;
  const right = anchor.left + anchor.width;
  const bottom = anchor.top + anchor.height;
  let top;
  let left;

  if (placement === 'right') {
    top = anchor.top + (anchor.height - tipSize.height) / 2;
    left = right + gap;
  } else {
    top = anchor.top - gap - tipSize.height;
    if (top < margin) top = bottom + gap;
    left = anchor.left + anchor.width / 2 - tipSize.width / 2;
  }

  const maxTop = Math.max(margin, viewport.height - tipSize.height - margin);
  const maxLeft = Math.max(margin, viewport.width - tipSize.width - margin);
  top = Math.max(margin, Math.min(top, maxTop));
  left = Math.max(margin, Math.min(left, maxLeft));
  return { top, left };
}

function ensureEscapeListener() {
  if (escapeBound || typeof document === 'undefined') return;
  escapeBound = true;
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      hideAllHoverTips();
    },
    true,
  );
}

/**
 * @param {{
 *   id?: string,
 *   className?: string,
 *   content?: string | Node | Node[],
 * }} [options]
 * @returns {HTMLElement}
 */
export function createHoverTip(options = {}) {
  ensureEscapeListener();
  const tip = document.createElement('div');
  tip.id = options.id || `hover-tip-${++tipSeq}`;
  tip.className = options.className || 'hover-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const content = options.content;
  if (typeof content === 'string') {
    tip.textContent = content;
  } else if (Array.isArray(content)) {
    tip.append(...content);
  } else if (content) {
    tip.append(content);
  }
  document.body.appendChild(tip);
  return tip;
}

/**
 * @param {HTMLElement} tip
 */
export function hideHoverTip(tip) {
  tip.hidden = true;
  openTips.delete(tip);
}

export function hideAllHoverTips() {
  for (const tip of [...openTips]) hideHoverTip(tip);
}

/**
 * 清掉可丢弃的目录 tip。默认选择器不含 `.hover-tip`，避免误删 `#rail-update-tip` 等常驻提示。
 * @param {string} [selector]
 */
export function clearHoverTips(selector = FOLDER_HOVER_TIP_CLEAR_SELECTOR) {
  if (typeof document === 'undefined') return;
  document.querySelectorAll(selector).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    openTips.delete(node);
    node.remove();
  });
}

/**
 * @param {HTMLElement} anchor
 * @param {HTMLElement} tip
 * @param {HoverTipPlacement} [placement]
 */
export function placeHoverTip(anchor, tip, placement = 'top') {
  // 先取消 hidden 再量尺寸，否则高度是 0（FAQ）。
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  const pos = computeHoverTipPosition(
    { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    { width: box.width, height: box.height },
    { width: window.innerWidth, height: window.innerHeight },
    placement,
  );
  tip.style.top = `${pos.top}px`;
  tip.style.left = `${pos.left}px`;
  openTips.add(tip);
}

/**
 * @param {HTMLElement} anchor
 * @param {HTMLElement} tip
 * @param {{ placement?: HoverTipPlacement, describedBy?: boolean }} [options]
 * @returns {{ show: () => void, hide: () => void, destroy: () => void }}
 */
export function bindHoverTip(anchor, tip, options = {}) {
  const placement = options.placement || 'top';
  const describedBy = options.describedBy !== false;
  if (describedBy && tip.id && !anchor.getAttribute('aria-describedby')) {
    anchor.setAttribute('aria-describedby', tip.id);
  }

  const show = () => placeHoverTip(anchor, tip, placement);
  const hide = () => hideHoverTip(tip);

  anchor.addEventListener('pointerenter', show);
  anchor.addEventListener('pointerleave', hide);
  anchor.addEventListener('focus', show);
  anchor.addEventListener('blur', hide);

  return {
    show,
    hide,
    destroy() {
      hide();
      anchor.removeEventListener('pointerenter', show);
      anchor.removeEventListener('pointerleave', hide);
      anchor.removeEventListener('focus', show);
      anchor.removeEventListener('blur', hide);
      if (describedBy && tip.id && anchor.getAttribute('aria-describedby') === tip.id) {
        anchor.removeAttribute('aria-describedby');
      }
      tip.remove();
    },
  };
}
