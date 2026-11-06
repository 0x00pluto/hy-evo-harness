/**
 * dex:// 导航地址解析。纯函数，可单测；主进程与文档共用同一套规则。
 */

export type DexNavigateCode =
  | 'INVALID_HREF'
  | 'PLUGIN_GONE'
  | 'NAVIGATE_CANCELLED'
  | 'NO_HOST_UI'
  | 'NAVIGATE_TIMEOUT';

export interface DexNavigateTarget {
  kind: 'settings-self';
  fieldKey?: string;
}

const FIELD_KEY = /^[A-Z][A-Z0-9_]*$/;

export class DexNavigateError extends Error {
  readonly code: DexNavigateCode;

  constructor(code: DexNavigateCode, message: string) {
    super(message);
    this.name = 'DexNavigateError';
    this.code = code;
  }
}

/** 解析插件导航地址。非法时抛 DexNavigateError(INVALID_HREF)。 */
export function parseDexNavigate(href: unknown): DexNavigateTarget {
  if (typeof href !== 'string' || href.trim() === '') {
    throw new DexNavigateError('INVALID_HREF', '导航地址无效');
  }
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    throw new DexNavigateError('INVALID_HREF', '导航地址无效');
  }
  if (parsed.protocol !== 'dex:') {
    throw new DexNavigateError('INVALID_HREF', '导航地址无效');
  }
  // dex://settings/self → host=settings, pathname=/self
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '') || '';
  if (host !== 'settings' || path !== '/self') {
    throw new DexNavigateError('INVALID_HREF', '导航地址无效');
  }
  if (parsed.search !== '') {
    throw new DexNavigateError('INVALID_HREF', '导航地址无效');
  }
  // WHATWG 会把裸 `#` 收成空 hash，与无片段等价。
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : '';
  if (hash === '') {
    return { kind: 'settings-self' };
  }
  if (!FIELD_KEY.test(hash)) {
    throw new DexNavigateError('INVALID_HREF', '导航地址无效');
  }
  return { kind: 'settings-self', fieldKey: hash };
}
