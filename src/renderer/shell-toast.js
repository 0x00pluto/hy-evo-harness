import { mountIcons } from './icons.js';
import { byId } from './dom.js';

const TOAST_MS = 4000;
let timer = 0;

export function mountShellToast() {
  const close = byId('shell-toast-close', 'button');
  close.addEventListener('click', () => {
    hideShellToast();
  });
}

/**
 * @param {string} message
 * @param {'ok' | 'error' | string} [kind]
 */
export function showShellToast(message, kind) {
  const toast = byId('shell-toast', 'div');
  const toastIcon = byId('shell-toast-icon', 'span');
  const toastText = byId('shell-toast-text', 'span');
  toastIcon.replaceChildren();
  const icon = document.createElement('i');
  icon.dataset.lucide = kind === 'ok' ? 'circle-check' : 'circle-x';
  toastIcon.appendChild(icon);
  toastText.textContent = message;
  toast.dataset.kind = kind === 'ok' ? 'ok' : 'error';
  toast.hidden = false;
  mountIcons(toast);
  window.clearTimeout(timer);
  timer = window.setTimeout(hideShellToast, TOAST_MS);
}

export function hideShellToast() {
  window.clearTimeout(timer);
  byId('shell-toast', 'div').hidden = true;
}
