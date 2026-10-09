const SIDEBAR_KEY = 'dex.sidebarWidth';
const SIDEBAR_DEFAULT = 292;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;

function clampSidebar(width) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

export function mountSidebar() {
  const sidebar = document.getElementById('sidebar');
  const splitter = document.getElementById('splitter');

  function applySidebarWidth(width) {
    const next = clampSidebar(width);
    document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
    splitter.setAttribute('aria-valuenow', String(next));
    return next;
  }

  function readSidebarWidth() {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw == null || raw === '') return SIDEBAR_DEFAULT;
      const width = Number(raw);
      if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
      return clampSidebar(width);
    } catch {
      return SIDEBAR_DEFAULT;
    }
  }

  function storeSidebarWidth(width) {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(width));
    } catch {
      // 隐私模式写不进去时，这次会话里的宽度仍然有效。
    }
  }

  applySidebarWidth(readSidebarWidth());

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try { splitter.setPointerCapture(event.pointerId); } catch { /* 指针尚未激活时忽略 */ }
    document.body.classList.add('is-resizing');
    const startX = event.clientX;
    const startWidth = sidebar.getBoundingClientRect().width;

    function move(ev) {
      applySidebarWidth(startWidth + (ev.clientX - startX));
    }

    function up(ev) {
      try { splitter.releasePointerCapture(ev.pointerId); } catch { /* 捕获已结束 */ }
      splitter.removeEventListener('pointermove', move);
      splitter.removeEventListener('pointerup', up);
      splitter.removeEventListener('pointercancel', up);
      document.body.classList.remove('is-resizing');
      storeSidebarWidth(applySidebarWidth(startWidth + (ev.clientX - startX)));
    }

    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', up);
    splitter.addEventListener('pointercancel', up);
  });

  splitter.addEventListener('dblclick', () => {
    storeSidebarWidth(applySidebarWidth(SIDEBAR_DEFAULT));
  });

  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = sidebar.getBoundingClientRect().width;
    const delta = event.key === 'ArrowRight' ? 16 : -16;
    storeSidebarWidth(applySidebarWidth(current + delta));
  });
}
