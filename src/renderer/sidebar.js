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

  function readWidth() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null || raw === '') return COLUMN_DEFAULT;
      const width = Number(raw);
      if (!Number.isFinite(width)) return COLUMN_DEFAULT;
      return clampColumn(width);
    } catch {
      return COLUMN_DEFAULT;
    }
  }

  function storeWidth(width) {
    try {
      localStorage.setItem(storageKey, String(width));
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
}

export function mountSidebar() {
  mountResizableColumn({
    column: document.getElementById('sidebar'),
    splitter: document.getElementById('splitter'),
    storageKey: 'dex.sidebarWidth',
    cssVariable: '--sidebar-width',
  });
  // 设置左栏和宽侧栏宽度分开记，避免拖一边时改掉另一边。
  mountResizableColumn({
    column: document.getElementById('settings-nav'),
    splitter: document.getElementById('settings-splitter'),
    storageKey: 'dex.settingsNavWidth',
    cssVariable: '--settings-nav-width',
  });
}
