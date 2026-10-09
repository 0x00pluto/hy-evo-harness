import { splitWidthKey } from './chrome-state.js';

const COLUMN_DEFAULT = 292;
const COLUMN_MIN = 220;
const COLUMN_MAX = 480;

function clampColumn(width) {
  return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(width)));
}

function mountResizableColumn({ column, splitter, storageKey, cssVariable }) {
  function applyWidth(width) {
    const next = clampColumn(width);
    document.documentElement.style.setProperty(cssVariable, `${next}px`);
    splitter.setAttribute('aria-valuenow', String(next));
    return next;
  }

  function currentKey() {
    return typeof storageKey === 'function' ? storageKey() : storageKey;
  }

  function readWidth() {
    const key = currentKey();
    if (!key) return COLUMN_DEFAULT;
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return COLUMN_DEFAULT;
      const width = Number(raw);
      if (!Number.isFinite(width)) return COLUMN_DEFAULT;
      return clampColumn(width);
    } catch {
      return COLUMN_DEFAULT;
    }
  }

  function storeWidth(width) {
    const key = currentKey();
    if (!key) return;
    try {
      localStorage.setItem(key, String(width));
    } catch {
      // 隐私模式写不进去时，这次会话里的宽度仍然有效。
    }
  }

  applyWidth(readWidth());

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try { splitter.setPointerCapture(event.pointerId); } catch { /* 指针尚未激活时忽略 */ }
    document.body.classList.add('is-resizing');
    const startX = event.clientX;
    const startWidth = column.getBoundingClientRect().width;

    function move(ev) {
      applyWidth(startWidth + (ev.clientX - startX));
    }

    function up(ev) {
      try { splitter.releasePointerCapture(ev.pointerId); } catch { /* 捕获已结束 */ }
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing');
      storeWidth(applyWidth(startWidth + (ev.clientX - startX)));
    }

    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });

  splitter.addEventListener('dblclick', () => {
    storeWidth(applyWidth(COLUMN_DEFAULT));
  });

  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = column.getBoundingClientRect().width;
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    storeWidth(applyWidth(current + delta));
  });

  return { applyStoredWidth() { applyWidth(readWidth()); } };
}

export function mountSidebar() {
  mountResizableColumn({
    column: document.getElementById('sidebar'),
    splitter: document.getElementById('splitter'),
    storageKey: 'dex.sidebarWidth',
    cssVariable: '--sidebar-width',
  });
  // 画面上只有一条分隔。拖的时候按当前表面写入对应的宽度键，避免改一边带掉另一边。
  const split = mountResizableColumn({
    column: document.getElementById('split-nav'),
    splitter: document.getElementById('split-splitter'),
    storageKey: () => splitWidthKey(document.body.dataset.surface),
    cssVariable: '--split-nav-width',
  });
  return { applySplitWidth: split.applyStoredWidth };
}
