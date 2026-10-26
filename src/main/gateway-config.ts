/** 网关 base URL：环境变量 > 开发配置 > 打包/未打包默认值。 */

export const DEV_DEFAULT_GATEWAY_BASE_URL = 'https://www.dexbuddy.app';
export const PROD_DEFAULT_GATEWAY_BASE_URL = 'https://www.dexbuddy.app';
export const GATEWAY_REDIRECT_URI = 'dexbuddy://auth/callback';
export const GATEWAY_ENV_KEY = 'DEX_GATEWAY_BASE_URL';

export function normalizeGatewayBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')}`;
}

export function resolveGatewayBaseUrl(options: {
  envValue?: string | null | undefined;
  configValue?: string | null | undefined;
  isPackaged: boolean;
}): string {
  const fromEnv = typeof options.envValue === 'string' ? normalizeGatewayBaseUrl(options.envValue) : null;
  if (fromEnv) return fromEnv;
  const fromConfig =
    typeof options.configValue === 'string' ? normalizeGatewayBaseUrl(options.configValue) : null;
  if (fromConfig) return fromConfig;
  return options.isPackaged ? PROD_DEFAULT_GATEWAY_BASE_URL : DEV_DEFAULT_GATEWAY_BASE_URL;
}
