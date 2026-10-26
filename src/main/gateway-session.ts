/**
 * 宿主网关会话：PKCE / 设备码 / 粘贴授权码、串行 refresh、safeStorage 密文。
 * Electron 能力经依赖注入，便于 node:test。
 */

import { createHash, randomBytes } from 'node:crypto';
import type {
  GatewayBuyoutView,
  GatewayLoginProgress,
  GatewaySessionView,
  OkResult,
} from '../shared/dex-bridge.ts';
import {
  GatewayError,
  gatewayRequest,
  parseDeviceAuthorization,
  parseEntitlements,
  parseShopCatalog,
  parseTokenPair,
  parseWallet,
  parseWhoami,
  type EntitlementItem,
  type TokenPair,
} from './gateway-client.ts';
import type { HostModelsRequestInit } from './host-egress.ts';
import { GATEWAY_REDIRECT_URI } from './gateway-config.ts';

export const PKCE_WAIT_MS = 5 * 60 * 1000;
export const ACCESS_REFRESH_SKEW_MS = 60 * 1000;
const SLOW_DOWN_EXTRA_SEC = 5;

export interface SecureStore {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(blob: Buffer): string;
  readBlob(): Buffer | null;
  writeBlob(blob: Buffer): void;
  clear(): void;
}

export interface GatewaySessionDeps {
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  openExternal: (url: string) => Promise<void>;
  store: SecureStore;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onChange?: (view: GatewaySessionView) => void;
}

interface StoredRefresh {
  v: 1;
  refreshToken: string;
}

type LoginKind = 'pkce' | 'device' | null;

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildLoginUrl(baseUrl: string, challenge: string): string {
  const url = new URL('/login', `${baseUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('redirect_uri', GATEWAY_REDIRECT_URI);
  return url.toString();
}

export function parseAuthCallback(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'dexbuddy:') return null;
  const host = url.hostname || '';
  const path = url.pathname.replace(/^\/+/, '');
  if (host === 'auth' && path === 'callback') {
    const code = url.searchParams.get('code');
    return typeof code === 'string' && code.trim() !== '' ? code.trim() : null;
  }
  // 兼容 dexbuddy:///auth/callback
  if (host === '' && path === 'auth/callback') {
    const code = url.searchParams.get('code');
    return typeof code === 'string' && code.trim() !== '' ? code.trim() : null;
  }
  return null;
}

export function formatBalanceLabel(balance: number | null, _currency?: string | null): string {
  if (balance === null) return '积分未知';
  return `${balance} 积分`;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class GatewaySession {
  private readonly deps: GatewaySessionDeps;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private accessExpiresAt = 0;
  private phoneMasked: string | null = null;
  private balance: number | null = null;
  private currency: string | null = null;
  private signedIn = false;
  private entitlements: EntitlementItem[] = [];
  private shopNames = new Map<string, string>();
  private shopIds = new Set<string>();
  private login: GatewayLoginProgress = { phase: 'idle' };
  private pkceVerifier: string | null = null;
  private pkceLoginUrl: string | null = null;
  private loginKind: LoginKind = null;
  private loginAbort: AbortController | null = null;
  private refreshInFlight: Promise<void> | null = null;
  /** 串行化 startPkce / reopenLogin，避免连点清掉 verifier。 */
  private loginStartChain: Promise<unknown> = Promise.resolve();
  private started = false;

  constructor(deps: GatewaySessionDeps) {
    this.deps = deps;
  }

  private runLoginStart<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.loginStartChain.then(fn, fn);
    this.loginStartChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private hasActivePkce(): boolean {
    return (
      this.loginKind === 'pkce' &&
      typeof this.pkceVerifier === 'string' &&
      this.pkceVerifier.length > 0 &&
      typeof this.pkceLoginUrl === 'string' &&
      this.pkceLoginUrl.length > 0
    );
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return (this.deps.sleep ?? defaultSleep)(ms, signal);
  }

  view(): GatewaySessionView {
    return {
      signedIn: this.signedIn,
      phoneMasked: this.signedIn ? this.phoneMasked : null,
      balance: this.signedIn ? this.balance : null,
      currency: this.signedIn ? this.currency : null,
      buyouts: this.signedIn ? this.buyoutViews() : [],
      login: { ...this.login },
    };
  }

  private buyoutViews(): GatewayBuyoutView[] {
    return this.entitlements
      .filter((item) => item.status === 'active')
      .map((item) => ({
        pluginId: item.pluginId,
        displayName: this.shopNames.get(item.pluginId) ?? item.pluginId,
      }));
  }

  private emit(): void {
    this.deps.onChange?.(this.view());
  }

  private setLogin(progress: GatewayLoginProgress): void {
    this.login = progress;
    this.emit();
  }

  private clearMemoryTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.accessExpiresAt = 0;
    this.signedIn = false;
    this.phoneMasked = null;
    this.balance = null;
    this.currency = null;
    this.entitlements = [];
    this.shopNames.clear();
    this.shopIds.clear();
  }

  private clearLoginState(): void {
    if (this.loginAbort) {
      this.loginAbort.abort();
      this.loginAbort = null;
    }
    this.pkceVerifier = null;
    this.pkceLoginUrl = null;
    this.loginKind = null;
  }

  private requireStore(): void {
    if (!this.deps.store.isAvailable()) {
      throw new GatewayError(
        'SERVER_ERROR',
        '本机无法安全保存登录凭证（safeStorage 不可用），请检查系统钥匙串或凭据服务后重试',
      );
    }
  }

  private persistRefresh(refreshToken: string): void {
    this.requireStore();
    const payload: StoredRefresh = { v: 1, refreshToken };
    const plain = JSON.stringify(payload);
    const blob = this.deps.store.encrypt(plain);
    this.deps.store.writeBlob(blob);
  }

  private loadStoredRefresh(): string | null {
    if (!this.deps.store.isAvailable()) return null;
    const blob = this.deps.store.readBlob();
    if (!blob || blob.length === 0) return null;
    let plain: string;
    try {
      plain = this.deps.store.decrypt(blob);
    } catch {
      this.deps.store.clear();
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plain) as unknown;
    } catch {
      this.deps.store.clear();
      return null;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as StoredRefresh).v !== 1 ||
      typeof (parsed as StoredRefresh).refreshToken !== 'string' ||
      (parsed as StoredRefresh).refreshToken.trim() === ''
    ) {
      this.deps.store.clear();
      return null;
    }
    return (parsed as StoredRefresh).refreshToken;
  }

  private applyTokens(pair: TokenPair): void {
    this.accessToken = pair.accessToken;
    this.refreshToken = pair.refreshToken;
    this.accessExpiresAt = this.now() + pair.expiresIn * 1000;
    this.persistRefresh(pair.refreshToken);
  }

  private async fetchSummaryWithAccess(accessToken: string): Promise<void> {
    const whoamiRaw = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/whoami', {
      method: 'GET',
      accessToken,
    });
    const whoami = parseWhoami(whoamiRaw);
    let balance = whoami.wallet.balance;
    let currency = whoami.wallet.currency;
    try {
      const walletRaw = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/wallet', {
        method: 'GET',
        accessToken,
      });
      const wallet = parseWallet(walletRaw);
      balance = wallet.balance;
      currency = wallet.currency;
    } catch {
      // whoami 已带钱包快照；独立 wallet 失败时仍可展示。
    }
    this.phoneMasked = whoami.phoneMasked;
    this.balance = balance;
    this.currency = currency;
    this.signedIn = true;
    await this.refreshRightsWithAccess(accessToken);
  }

  private async refreshRightsWithAccess(accessToken: string): Promise<void> {
    try {
      const raw = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/entitlements', {
        method: 'GET',
        accessToken,
      });
      this.entitlements = parseEntitlements(raw).entitlements;
    } catch {
      this.entitlements = [];
    }
    try {
      const raw = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/api/shop/catalog', {
        method: 'GET',
        accessToken,
      });
      const catalog = parseShopCatalog(raw);
      this.shopIds = new Set(catalog.plugins.map((item) => item.pluginId));
      this.shopNames = new Map(
        catalog.plugins
          .filter((item) => item.name)
          .map((item) => [item.pluginId, item.name as string]),
      );
    } catch {
      // 目录失败时保留上次缓存；从未成功过则集合为空，烧钱闸会放行非缓存项。
    }
  }

  /** 已登录业务请求：补 Bearer，401 时 refresh 再试一次。 */
  async authorizedJson(path: string, init: HostModelsRequestInit): Promise<unknown> {
    return this.withAuthRetry((accessToken) =>
      gatewayRequest(this.deps.fetch, this.deps.baseUrl, path, {
        method: init.method,
        body: init.body,
        accessToken,
        headers: init.headers,
      }),
    );
  }

  async shopPluginIds(): Promise<string[]> {
    await this.ensureAccess();
    if (this.shopIds.size === 0 && this.accessToken) {
      await this.refreshRightsWithAccess(this.accessToken);
    }
    return [...this.shopIds];
  }

  async activeEntitlements(): Promise<string[]> {
    await this.ensureAccess();
    return this.entitlements.filter((item) => item.status === 'active').map((item) => item.pluginId);
  }

  shopUrl(): string {
    return `${this.deps.baseUrl.replace(/\/+$/, '')}/shop`;
  }

  async openShop(): Promise<OkResult> {
    try {
      await this.deps.openExternal(this.shopUrl());
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '无法打开购买积分页面' };
    }
  }

  private async refreshTokensUnlocked(): Promise<void> {
    const refresh = this.refreshToken ?? this.loadStoredRefresh();
    if (!refresh) {
      this.clearMemoryTokens();
      this.deps.store.clear();
      throw new GatewayError('UNAUTHORIZED', '未登录');
    }
    try {
      const body = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: refresh },
      });
      const pair = parseTokenPair(body);
      this.applyTokens(pair);
    } catch (err) {
      this.clearMemoryTokens();
      this.deps.store.clear();
      throw err;
    }
  }

  /** 进行中的 refresh 合并为一次，避免旧 refresh 复用整会话作废。 */
  refreshSerial(): Promise<void> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshTokensUnlocked().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async ensureAccess(): Promise<string> {
    if (this.accessToken && this.now() + ACCESS_REFRESH_SKEW_MS < this.accessExpiresAt) {
      return this.accessToken;
    }
    await this.refreshSerial();
    if (!this.accessToken) throw new GatewayError('UNAUTHORIZED', '未登录');
    return this.accessToken;
  }

  private async withAuthRetry<T>(fn: (accessToken: string) => Promise<T>): Promise<T> {
    const access = await this.ensureAccess();
    try {
      return await fn(access);
    } catch (err) {
      if (err instanceof GatewayError && (err.status === 401 || err.code === 'UNAUTHORIZED')) {
        await this.refreshSerial();
        if (!this.accessToken) throw err;
        return fn(this.accessToken);
      }
      throw err;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const refresh = this.loadStoredRefresh();
    if (!refresh) {
      this.emit();
      return;
    }
    this.refreshToken = refresh;
    try {
      await this.refreshSerial();
      await this.fetchSummaryWithAccess(this.accessToken!);
      this.emit();
    } catch {
      this.clearMemoryTokens();
      this.deps.store.clear();
      this.emit();
    }
  }

  async startPkce(): Promise<OkResult> {
    return this.runLoginStart(() => this.startPkceUnlocked());
  }

  private async startPkceUnlocked(): Promise<OkResult> {
    if (this.signedIn) return { ok: false, message: '已登录' };
    // 进行中再点：只重新打开同一登录页，绝不换 verifier。
    if (this.hasActivePkce()) {
      return this.reopenLoginUnlocked();
    }
    try {
      this.requireStore();
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法保存登录凭证';
      this.setLogin({ phase: 'failed', message });
      return { ok: false, message };
    }
    this.clearLoginState();
    const { verifier, challenge } = createPkcePair();
    this.pkceVerifier = verifier;
    this.pkceLoginUrl = buildLoginUrl(this.deps.baseUrl, challenge);
    this.loginKind = 'pkce';
    this.loginAbort = new AbortController();
    const signal = this.loginAbort.signal;
    this.setLogin({
      phase: 'opening_browser',
      canReopenLogin: true,
    });
    try {
      await this.deps.openExternal(this.pkceLoginUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法打开浏览器';
      this.clearLoginState();
      this.setLogin({ phase: 'idle' });
      return { ok: false, message };
    }
    this.setLogin({
      phase: 'waiting_callback',
      canReopenLogin: true,
    });
    void this.waitPkceTimeout(signal);
    return { ok: true };
  }

  private async waitPkceTimeout(signal: AbortSignal): Promise<void> {
    try {
      await this.sleep(PKCE_WAIT_MS, signal);
    } catch {
      return;
    }
    if (this.loginKind !== 'pkce') return;
    this.clearLoginState();
    // 超时回到未登录，用户再点「登录」即可，不展示错误文案。
    this.setLogin({ phase: 'idle' });
  }

  async reopenLogin(): Promise<OkResult> {
    return this.runLoginStart(() => this.reopenLoginUnlocked());
  }

  private async reopenLoginUnlocked(): Promise<OkResult> {
    if (!this.hasActivePkce() || !this.pkceLoginUrl) {
      return this.startPkceUnlocked();
    }
    try {
      await this.deps.openExternal(this.pkceLoginUrl);
      this.setLogin({
        phase: 'waiting_callback',
        canReopenLogin: true,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '无法打开浏览器' };
    }
  }

  /** @returns 是否已成功兑换并写入会话 */
  async handleAuthUrl(rawUrl: string): Promise<boolean> {
    const code = parseAuthCallback(rawUrl);
    if (!code) return false;
    const result = await this.exchangePkceCode(code);
    if (!result.ok) {
      console.error(`[gateway-session] 授权码兑换失败: ${result.message ?? '未知错误'}`);
    }
    return result.ok;
  }

  async submitAuthCode(code: string): Promise<OkResult> {
    const trimmed = code.trim();
    if (trimmed === '') return { ok: false, message: '请粘贴授权码' };
    if (!this.pkceVerifier) {
      return { ok: false, message: '没有进行中的登录，请先点登录' };
    }
    return this.exchangePkceCode(trimmed);
  }

  private async exchangePkceCode(code: string): Promise<OkResult> {
    const verifier = this.pkceVerifier;
    if (!verifier) return { ok: false, message: '没有进行中的登录' };
    this.setLogin({
      phase: 'exchanging',
      message: '正在完成登录…',
      canCancel: false,
      canPasteCode: false,
      canReopenLogin: false,
    });
    try {
      this.requireStore();
      const body = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/auth/exchange', {
        method: 'POST',
        body: { code, codeVerifier: verifier },
      });
      const pair = parseTokenPair(body);
      this.applyTokens(pair);
      await this.fetchSummaryWithAccess(pair.accessToken);
      this.clearLoginState();
      this.setLogin({ phase: 'idle' });
      this.emit();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : '登录失败';
      this.clearLoginState();
      this.setLogin({ phase: 'failed', message });
      return { ok: false, message };
    }
  }

  async startDevice(): Promise<OkResult> {
    if (this.signedIn) return { ok: false, message: '已登录' };
    try {
      this.requireStore();
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法保存登录凭证';
      this.setLogin({ phase: 'failed', message });
      return { ok: false, message };
    }
    this.clearLoginState();
    this.loginKind = 'device';
    this.loginAbort = new AbortController();
    const signal = this.loginAbort.signal;
    this.setLogin({
      phase: 'opening_browser',
      message: '正在获取设备码…',
      canCancel: true,
    });
    try {
      const raw = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/auth/device', {
        method: 'POST',
      });
      const device = parseDeviceAuthorization(raw);
      this.setLogin({
        phase: 'device_pending',
        message: '请在浏览器确认设备码',
        userCode: device.userCode,
        canCancel: true,
      });
      try {
        await this.deps.openExternal(device.verificationUriComplete || device.verificationUri);
      } catch {
        // 仍可手工打开 verificationUri；轮询继续。
      }
      void this.pollDevice(device.deviceCode, device.interval, device.expiresIn, signal);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法启动设备码登录';
      this.clearLoginState();
      this.setLogin({ phase: 'failed', message });
      return { ok: false, message };
    }
  }

  private async pollDevice(
    deviceCode: string,
    intervalSec: number,
    expiresInSec: number,
    signal: AbortSignal,
  ): Promise<void> {
    let interval = Math.max(1, intervalSec) * 1000;
    const deadline = this.now() + expiresInSec * 1000;
    while (!signal.aborted) {
      if (this.now() >= deadline) {
        this.clearLoginState();
        this.setLogin({ phase: 'failed', message: '设备码已过期，请重试' });
        return;
      }
      try {
        await this.sleep(interval, signal);
      } catch {
        return;
      }
      if (signal.aborted || this.loginKind !== 'device') return;
      try {
        const body = await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/auth/exchange', {
          method: 'POST',
          body: { deviceCode },
        });
        const pair = parseTokenPair(body);
        this.applyTokens(pair);
        await this.fetchSummaryWithAccess(pair.accessToken);
        this.clearLoginState();
        this.setLogin({ phase: 'idle' });
        this.emit();
        return;
      } catch (err) {
        if (!(err instanceof GatewayError)) {
          this.clearLoginState();
          this.setLogin({
            phase: 'failed',
            message: err instanceof Error ? err.message : '设备码登录失败',
          });
          return;
        }
        if (err.code === 'AUTHORIZATION_PENDING') continue;
        if (err.code === 'SLOW_DOWN') {
          interval += SLOW_DOWN_EXTRA_SEC * 1000;
          continue;
        }
        if (err.code === 'ACCESS_DENIED' || err.code === 'EXPIRED_TOKEN' || err.code === 'INVALID_GRANT') {
          this.clearLoginState();
          this.setLogin({ phase: 'failed', message: err.message });
          return;
        }
        this.clearLoginState();
        this.setLogin({ phase: 'failed', message: err.message });
        return;
      }
    }
  }

  async cancelLogin(): Promise<OkResult> {
    if (this.login.phase === 'idle' || this.login.phase === 'exchanging') {
      return { ok: false, message: '没有可取消的登录' };
    }
    this.clearLoginState();
    this.setLogin({ phase: 'idle' });
    return { ok: true };
  }

  async refreshSummary(): Promise<OkResult> {
    try {
      await this.withAuthRetry(async (access) => {
        await this.fetchSummaryWithAccess(access);
      });
      this.emit();
      return { ok: true };
    } catch (err) {
      this.emit();
      return { ok: false, message: err instanceof Error ? err.message : '同步失败' };
    }
  }

  async logout(): Promise<OkResult> {
    const access = this.accessToken;
    const refresh = this.refreshToken ?? this.loadStoredRefresh();
    try {
      if (access || refresh) {
        await gatewayRequest(this.deps.fetch, this.deps.baseUrl, '/v1/auth/revoke', {
          method: 'POST',
          accessToken: access ?? undefined,
          body: refresh ? { refreshToken: refresh } : undefined,
        }).catch(() => undefined);
      }
    } finally {
      this.clearLoginState();
      this.clearMemoryTokens();
      this.deps.store.clear();
      this.setLogin({ phase: 'idle' });
    }
    return { ok: true };
  }
}

export function createFileSecureStore(options: {
  isAvailable: () => boolean;
  encryptString: (plain: string) => Buffer;
  decryptString: (blob: Buffer) => string;
  readFile: () => Buffer | null;
  writeFile: (blob: Buffer) => void;
  removeFile: () => void;
}): SecureStore {
  return {
    isAvailable: options.isAvailable,
    encrypt: options.encryptString,
    decrypt: options.decryptString,
    readBlob: options.readFile,
    writeBlob: options.writeFile,
    clear: options.removeFile,
  };
}
