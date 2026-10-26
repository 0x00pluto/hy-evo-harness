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
  | 'BAD_RESPONSE'
  | 'NOT_ENTITLED'
  | 'INSUFFICIENT_CREDITS'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MODEL_NOT_ALLOWED'
  | 'CHANNEL_NOT_READY'
  | 'UPSTREAM_ERROR'
  | 'FILE_QUOTA'
  | 'FILE_NOT_USABLE'
  | 'OUTPUT_EXPIRED'
  | 'KEY_LIMIT'
  | 'KEY_NOT_FOUND';

export class GatewayError extends Error {
  readonly code: string;
  readonly retryAfter?: number;
  readonly status: number;

  constructor(code: string, message: string, status = 0, retryAfter?: number) {
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

export interface EntitlementItem {
  pluginId: string;
  status: 'active' | 'revoked';
}

export interface EntitlementsBody {
  entitlements: EntitlementItem[];
}

export interface PublicModel {
  id: string;
  object: 'model';
  kind?: 'chat' | 'image';
  display_name?: string;
}

export interface ModelsList {
  object: 'list';
  data: PublicModel[];
}

export interface BillingQuote {
  kind: 'chat' | 'image';
  estimate: string;
  enough: boolean;
  balance: string;
  model: string;
  maxTokens?: number;
  promptTokensEstimate?: number;
  creditsPerImage?: string;
}

export interface FilesIssue {
  id: string;
  key: string;
  uploadUrl: string;
  token: string;
  expiresAt: string;
}

export interface ImageGenerate {
  downloadUrl: string;
  mediaType: string;
  expiresAt: string;
  model: string;
}

export interface ShopPluginProduct {
  pluginId: string;
  name?: string;
}

export interface ShopCatalog {
  plugins: ShopPluginProduct[];
  ownedPluginIds: string[];
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
  const nested = record ? asRecord(record.error) : null;
  if (nested && typeof nested.message === 'string' && nested.message.trim() !== '') {
    const code = typeof nested.code === 'string' && nested.code.trim() !== '' ? nested.code : 'BAD_RESPONSE';
    return new GatewayError(code, nested.message, status);
  }
  const codeRaw = record && typeof record.code === 'string' ? record.code : 'BAD_RESPONSE';
  const code = codeRaw || 'BAD_RESPONSE';
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
    headers?: Record<string, string>;
  },
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...init.headers,
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

export function parseEntitlements(body: unknown): EntitlementsBody {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.entitlements)) {
    throw new GatewayError('BAD_RESPONSE', '网关 entitlements 无效');
  }
  const entitlements: EntitlementItem[] = [];
  for (const item of record.entitlements) {
    const row = asRecord(item);
    if (!row || typeof row.pluginId !== 'string' || row.pluginId.trim() === '') continue;
    const status = row.status === 'revoked' ? 'revoked' : row.status === 'active' ? 'active' : null;
    if (!status) continue;
    entitlements.push({ pluginId: row.pluginId.trim(), status });
  }
  return { entitlements };
}

export function parseModelsList(body: unknown): ModelsList {
  const record = asRecord(body);
  if (!record || record.object !== 'list' || !Array.isArray(record.data)) {
    throw new GatewayError('BAD_RESPONSE', '网关 models 无效');
  }
  const data: PublicModel[] = [];
  for (const item of record.data) {
    const row = asRecord(item);
    if (!row || typeof row.id !== 'string' || row.id.trim() === '') continue;
    const model: PublicModel = { id: row.id.trim(), object: 'model' };
    if (row.kind === 'chat' || row.kind === 'image') model.kind = row.kind;
    if (typeof row.display_name === 'string' && row.display_name.trim() !== '') {
      model.display_name = row.display_name.trim();
    }
    data.push(model);
  }
  return { object: 'list', data };
}

export function parseBillingQuote(body: unknown): BillingQuote {
  const record = asRecord(body);
  if (
    !record ||
    (record.kind !== 'chat' && record.kind !== 'image') ||
    typeof record.estimate !== 'string' ||
    typeof record.enough !== 'boolean' ||
    typeof record.balance !== 'string' ||
    typeof record.model !== 'string'
  ) {
    throw new GatewayError('BAD_RESPONSE', '网关 quote 无效');
  }
  const quote: BillingQuote = {
    kind: record.kind,
    estimate: record.estimate,
    enough: record.enough,
    balance: record.balance,
    model: record.model,
  };
  if (typeof record.maxTokens === 'number' && Number.isFinite(record.maxTokens)) {
    quote.maxTokens = record.maxTokens;
  }
  if (typeof record.promptTokensEstimate === 'number' && Number.isFinite(record.promptTokensEstimate)) {
    quote.promptTokensEstimate = record.promptTokensEstimate;
  }
  if (typeof record.creditsPerImage === 'string') quote.creditsPerImage = record.creditsPerImage;
  return quote;
}

export function parseFilesIssue(body: unknown): FilesIssue {
  const record = asRecord(body);
  if (
    !record ||
    typeof record.id !== 'string' ||
    typeof record.key !== 'string' ||
    typeof record.uploadUrl !== 'string' ||
    typeof record.token !== 'string' ||
    typeof record.expiresAt !== 'string'
  ) {
    throw new GatewayError('BAD_RESPONSE', '网关 files 凭证无效');
  }
  if (
    record.id.trim() === '' ||
    record.key.trim() === '' ||
    record.uploadUrl.trim() === '' ||
    record.token.trim() === ''
  ) {
    throw new GatewayError('BAD_RESPONSE', '网关 files 凭证无效');
  }
  return {
    id: record.id,
    key: record.key,
    uploadUrl: record.uploadUrl,
    token: record.token,
    expiresAt: record.expiresAt,
  };
}

export function parseImageGenerate(body: unknown): ImageGenerate {
  const record = asRecord(body);
  if (
    !record ||
    typeof record.downloadUrl !== 'string' ||
    record.downloadUrl.trim() === '' ||
    typeof record.mediaType !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    typeof record.model !== 'string'
  ) {
    throw new GatewayError('BAD_RESPONSE', '网关生图结果无效');
  }
  return {
    downloadUrl: record.downloadUrl,
    mediaType: record.mediaType,
    expiresAt: record.expiresAt,
    model: record.model,
  };
}

function shopPluginName(row: Record<string, unknown>): string | undefined {
  for (const key of ['name', 'displayName', 'title'] as const) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

export function parseShopCatalog(body: unknown): ShopCatalog {
  const record = asRecord(body);
  const catalog = record ? asRecord(record.catalog) : record;
  if (!catalog || !Array.isArray(catalog.plugins)) {
    throw new GatewayError('BAD_RESPONSE', '网关商城目录无效');
  }
  const plugins: ShopPluginProduct[] = [];
  for (const item of catalog.plugins) {
    const row = asRecord(item);
    if (!row || typeof row.pluginId !== 'string' || row.pluginId.trim() === '') continue;
    const product: ShopPluginProduct = { pluginId: row.pluginId.trim() };
    const name = shopPluginName(row);
    if (name) product.name = name;
    plugins.push(product);
  }
  const ownedPluginIds: string[] = [];
  if (Array.isArray(catalog.ownedPluginIds)) {
    for (const id of catalog.ownedPluginIds) {
      if (typeof id === 'string' && id.trim() !== '') ownedPluginIds.push(id.trim());
    }
  }
  return { plugins, ownedPluginIds };
}
