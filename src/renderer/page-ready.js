/**
 * 插件页样式就绪判定（纯函数，供单测与打开门闩共用）。
 *
 * @param {{ total?: unknown; loaded?: unknown } | null | undefined} report
 * @returns {{ ok: boolean; reason: string }}
 */
export function stylesheetReady(report) {
  if (!report || typeof report !== 'object') {
    return { ok: false, reason: 'invalid' };
  }
  const total = report.total;
  const loaded = report.loaded;
  if (typeof total !== 'number' || typeof loaded !== 'number') {
    return { ok: false, reason: 'invalid' };
  }
  if (!Number.isFinite(total) || !Number.isFinite(loaded) || total < 0 || loaded < 0) {
    return { ok: false, reason: 'invalid' };
  }
  if (total === 0) return { ok: true, reason: 'no-sheets' };
  if (loaded >= total) return { ok: true, reason: 'ready' };
  return { ok: false, reason: 'pending' };
}

/** 在 guest 页执行，返回 { total, loaded }。 */
export const STYLESHEET_PROBE = `(() => {
  const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'));
  let loaded = 0;
  for (const link of links) {
    try {
      if (link.sheet) loaded += 1;
    } catch (_) {
      // 跨域等读不到 sheet 视为未加载
    }
  }
  return { total: links.length, loaded };
})()`;
