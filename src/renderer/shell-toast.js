import { mountIcons } from './icons.js';

const TOAST_MS = 4000;
let timer = 0;

export function mountShellToast() {
  const close = document.getElementById('shell-toast-close');
  close.addEventListener('click', () => {
    hideShellToast();
  });
}

/**
 * @param {string} message
 * @param {'ok' | 'error' | string} [kind]
 */
export function showShellToast(message, kind) {
  const toast = document.getElementById('shell-toast');
  const toastIcon = document.getElementById('shell-toast-icon');
  const toastText = document.getElementById('shell-toast-text');
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
  document.getElementById('shell-toast').hidden = true;
}
