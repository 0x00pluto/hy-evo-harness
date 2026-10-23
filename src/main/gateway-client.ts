/** 网关 JSON HTTP：识别 ErrorBody.code，不把 token 写进日志。 */

export type GatewayErrorCode =
  | 'INVALID_BODY'
  | 'INVALID_PHONE'
  | 'INVALID_OTP'
  | 'INVALID_PKCE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INVALID_GRANT'
  | 'AUTHORIZATION_PENDING'
  | 'SLOW_DOWN'
  | 'ACCESS_DENIED'
  | 'EXPIRED_TOKEN'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'BAD_RESPONSE';

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly retryAfter?: number;
  readonly status: number;

  constructor(code: GatewayErrorCode, message: string, status = 0, retryAfter?: number) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
    if (typeof retryAfter === 'number') this.retryAfter = retryAfter;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface WhoamiBody {
  userId: string;
  phoneMasked: string | null;
  accountKind: string;
  wallet: { balance: number; currency: string };
  organizations: unknown[];
}

export interface WalletBody {
  balance: number;
  currency: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** OpenAPI：balance 为四位小数字符串；兼容有限 number。 */
export function parseCreditsBalance(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new GatewayError('BAD_RESPONSE', '网关余额无效');
    }
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new GatewayError('BAD_RESPONSE', '网关余额无效');
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      throw new GatewayError('BAD_RESPONSE', '网关余额无效');
    }
    return n;
  }
  throw new GatewayError('BAD_RESPONSE', '网关余额无效');
}

function readError(body: unknown, status: number): GatewayError {
  const record = asRecord(body);
  const codeRaw = record && typeof record.code === 'string' ? record.code : 'BAD_RESPONSE';
  const code = (codeRaw as GatewayErrorCode) || 'BAD_RESPONSE';
  const error =
    record && typeof record.error === 'string' && record.error.trim() !== ''
      ? record.error
      : `网关请求失败（${status}）`;
  const retryAfter =
    record && typeof record.retryAfter === 'number' && Number.isFinite(record.retryAfter)
      ? record.retryAfter
      : undefined;
  return new GatewayError(code, error, status, retryAfter);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GatewayError('BAD_RESPONSE', '网关返回了无法解析的响应', response.status);
  }
}

export async function gatewayRequest(
  fetchImpl: FetchLike,
  baseUrl: string,
  path: string,
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
    accessToken?: string;
  },
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new GatewayError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : '无法连接网关',
      0,
    );
  }

  const body = await readJson(response);
  if (!response.ok) throw readError(body, response.status);
  return body;
}

export function parseTokenPair(body: unknown): TokenPair {
  const record = asRecord(body);
  if (!record || record.ok !== true) {
    throw new GatewayError('BAD_RESPONSE', '网关未返回有效令牌');
  }
  const accessToken = record.accessToken;
  const refreshToken = record.refreshToken;
  const expiresIn = record.expiresIn;
  if (typeof accessToken !== 'string' || accessToken.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关未返回 access token');
  }
  if (typeof refreshToken !== 'string' || refreshToken.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关未返回 refresh token');
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new GatewayError('BAD_RESPONSE', '网关未返回有效过期时间');
  }
  return { accessToken, refreshToken, expiresIn };
}

export function parseDeviceAuthorization(body: unknown): DeviceAuthorization {
  const record = asRecord(body);
  if (!record || record.ok !== true) {
    throw new GatewayError('BAD_RESPONSE', '网关未返回设备码');
  }
  const deviceCode = record.deviceCode;
  const userCode = record.userCode;
  const verificationUri = record.verificationUri;
  const verificationUriComplete = record.verificationUriComplete;
  const expiresIn = record.expiresIn;
  const interval = record.interval;
  if (typeof deviceCode !== 'string' || deviceCode.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关未返回 deviceCode');
  }
  if (typeof userCode !== 'string' || userCode.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关未返回 userCode');
  }
  if (typeof verificationUri !== 'string' || verificationUri.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关未返回 verificationUri');
  }
  if (typeof verificationUriComplete !== 'string' || verificationUriComplete.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关未返回 verificationUriComplete');
  }
  if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new GatewayError('BAD_RESPONSE', '网关未返回有效过期时间');
  }
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval < 0) {
    throw new GatewayError('BAD_RESPONSE', '网关未返回有效轮询间隔');
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval,
  };
}

export function parseWhoami(body: unknown): WhoamiBody {
  const record = asRecord(body);
  if (!record || typeof record.userId !== 'string') {
    throw new GatewayError('BAD_RESPONSE', '网关 whoami 无效');
  }
  const wallet = asRecord(record.wallet);
  if (!wallet || typeof wallet.currency !== 'string' || wallet.currency.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关 whoami.wallet 无效');
  }
  let balance: number;
  try {
    balance = parseCreditsBalance(wallet.balance);
  } catch {
    throw new GatewayError('BAD_RESPONSE', '网关 whoami.wallet 无效');
  }
  return {
    userId: record.userId,
    phoneMasked: typeof record.phoneMasked === 'string' ? record.phoneMasked : null,
    accountKind: typeof record.accountKind === 'string' ? record.accountKind : 'personal',
    wallet: { balance, currency: wallet.currency },
    organizations: Array.isArray(record.organizations) ? record.organizations : [],
  };
}

export function parseWallet(body: unknown): WalletBody {
  const record = asRecord(body);
  if (!record || typeof record.currency !== 'string' || record.currency.trim() === '') {
    throw new GatewayError('BAD_RESPONSE', '网关 wallet 无效');
  }
  let balance: number;
  try {
    balance = parseCreditsBalance(record.balance);
  } catch {
    throw new GatewayError('BAD_RESPONSE', '网关 wallet 无效');
  }
  return { balance, currency: record.currency };
}
