/**
 * 插件经宿主调用网关：盖清单 id、先登录再买断再报价、再转发。
 * 文案对齐 OpenAI；生图 input 对齐 Replicate 字段名。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  GatewayError,
  parseBillingQuote,
  parseFilesIssue,
  parseImageGenerate,
  parseModelsList,
  type BillingQuote,
  type ModelsList,
} from './gateway-client.ts';
import type { SpendBlockedPayload, SpendBlockedReason } from '../shared/dex-bridge.ts';
import type { HostImageGenerateInput, HostImageGenerateResult, HostModels, HostModelsCallOptions } from './types.ts';

export function unavailableHostModels(message = '网关未就绪'): HostModels {
  const fail = async (): Promise<never> => {
    throw new GatewayError('UNAUTHORIZED', message, 401);
  };
  return {
    list: fail,
    billing: { quote: fail },
    chat: { completions: { create: fail } },
    images: { generate: fail },
  };
}

export function unavailableRequireEntitlement(message = '网关未就绪'): () => Promise<void> {
  return async () => {
    throw new GatewayError('UNAUTHORIZED', message, 401);
  };
}

export interface HostModelsRequestInit {
  method: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ShopGate {
  /** false：本次目录失败，买断闸放行，不得拿上一份缓存来拦。 */
  ready: boolean;
  pluginIds: Iterable<string>;
}

export interface HostModelsDeps {
  pluginId: string;
  request: (path: string, init: HostModelsRequestInit) => Promise<unknown>;
  requireSession: () => Promise<void>;
  shopGate: () => Promise<ShopGate>;
  activeEntitlements: () => Promise<Iterable<string>>;
  /** 目录里被平台标为限免的 id。字段未上线前恒为空。 */
  waivedPluginIds?: () => Promise<Iterable<string>>;
  onBlocked?: (payload: SpendBlockedPayload) => void;
  readFile?: (filePath: string) => Buffer;
  writeFile?: (filePath: string, data: Buffer) => void;
  mkdir?: (dirPath: string) => void;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

function spendBlockedReason(code: string): SpendBlockedReason | null {
  if (code === 'NOT_ENTITLED' || code === 'UNAUTHORIZED' || code === 'INSUFFICIENT_CREDITS') {
    return code;
  }
  return null;
}

/** 通知壳弹框；失败不影响原错误回到插件。 */
function notifyBlocked(deps: HostModelsDeps, err: unknown): void {
  if (!(err instanceof GatewayError) || !deps.onBlocked) return;
  const reason = spendBlockedReason(err.code);
  if (!reason) return;
  try {
    deps.onBlocked({ pluginId: deps.pluginId, reason });
  } catch {
    // 壳没接上时仍把原错误交给插件。
  }
}

async function spendOrThrow<T>(deps: HostModelsDeps, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    notifyBlocked(deps, err);
    throw err;
  }
}

function pluginHeaders(pluginId: string, options?: HostModelsCallOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Plugin-Id': pluginId,
  };
  const key = options?.idempotencyKey;
  if (typeof key === 'string' && key.trim() !== '') {
    headers['Idempotency-Key'] = key.trim();
  }
  return headers;
}

function withoutPluginId(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { pluginId: _ignored, ...rest } = body as Record<string, unknown>;
  return rest;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function readInputImages(input: Record<string, unknown> | null): string[] {
  if (!input) return [];
  const raw = input.input_images;
  if (!Array.isArray(raw)) return [];
  const paths: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    paths.push(item.trim());
  }
  return paths;
}

function quoteBodyForImage(model: string): Record<string, unknown> {
  return { model };
}

function quoteBodyForChat(body: unknown): Record<string, unknown> {
  const record = asRecord(withoutPluginId(body)) ?? {};
  const quote: Record<string, unknown> = {};
  if (typeof record.model === 'string') quote.model = record.model;
  if (Array.isArray(record.messages)) quote.messages = record.messages;
  if (typeof record.max_tokens === 'number') quote.max_tokens = record.max_tokens;
  return quote;
}

export async function assertEntitled(deps: HostModelsDeps): Promise<void> {
  await deps.requireSession();
  const gate = await deps.shopGate();
  if (!gate.ready) return;
  const shop = new Set(gate.pluginIds);
  if (!shop.has(deps.pluginId)) return;
  const waived = new Set(deps.waivedPluginIds ? await deps.waivedPluginIds() : []);
  if (waived.has(deps.pluginId)) return;
  const owned = new Set(await deps.activeEntitlements());
  if (!owned.has(deps.pluginId)) {
    throw new GatewayError('NOT_ENTITLED', '尚未买断该插件', 403);
  }
}

const PLAYGROUND_ID = 'models-playground';

function playgroundMock(
  pluginId: string,
  args: unknown[],
): { pluginId: string; mockOwned?: boolean } | null {
  if (pluginId !== PLAYGROUND_ID) return null;
  const record = asRecord(args[0]);
  if (!record) return null;
  const id = typeof record.pluginId === 'string' ? record.pluginId.trim() : '';
  if (!id) return null;
  const mockOwned = record.mockOwned === true ? true : record.mockOwned === false ? false : undefined;
  return { pluginId: id, mockOwned };
}

/** 无参。试玩可传 mock 选项；其它插件传入的 id 无效，闭包只用当前清单 id。 */
export function createRequireEntitlement(deps: HostModelsDeps): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const mock = playgroundMock(deps.pluginId, args);
    if (!mock) {
      await spendOrThrow(deps, () => assertEntitled(deps));
      return;
    }
    const next: HostModelsDeps = {
      ...deps,
      pluginId: mock.pluginId,
      onBlocked: deps.onBlocked
        ? (payload) => {
            deps.onBlocked?.({ ...payload, pluginId: deps.pluginId });
          }
        : undefined,
    };
    if (mock.mockOwned === true || mock.mockOwned === false) {
      const owned = mock.mockOwned;
      next.shopGate = async () => {
        const gate = await deps.shopGate();
        const pluginIds = [...gate.pluginIds];
        if (!pluginIds.includes(mock.pluginId)) pluginIds.push(mock.pluginId);
        return { ready: true, pluginIds };
      };
      next.activeEntitlements = async () => {
        const current = [...await deps.activeEntitlements()];
        if (owned) {
          return current.includes(mock.pluginId) ? current : [...current, mock.pluginId];
        }
        return current.filter((id) => id !== mock.pluginId);
      };
    }
    await spendOrThrow(next, () => assertEntitled(next));
  };
}

async function quoteOrThrow(
  deps: HostModelsDeps,
  body: Record<string, unknown>,
  options?: HostModelsCallOptions,
): Promise<BillingQuote> {
  const raw = await deps.request('/v1/billing/quote', {
    method: 'POST',
    body,
    headers: pluginHeaders(deps.pluginId, options),
  });
  const quote = parseBillingQuote(raw);
  if (!quote.enough) {
    throw new GatewayError('INSUFFICIENT_CREDITS', '积分不足', 402);
  }
  return quote;
}

async function uploadReference(
  deps: HostModelsDeps,
  filePath: string,
  options?: HostModelsCallOptions,
): Promise<string> {
  const readFile = deps.readFile ?? ((p: string) => fs.readFileSync(p));
  const bytes = readFile(filePath);
  if (!bytes || bytes.length === 0) {
    throw new GatewayError('INVALID_BODY', `参考图是空的：${filePath}`, 400);
  }
  const contentType = mimeFromPath(filePath);
  const issuedRaw = await deps.request('/v1/files', {
    method: 'POST',
    body: { contentType, contentLength: bytes.length },
    headers: pluginHeaders(deps.pluginId, options),
  });
  const issued = parseFilesIssue(issuedRaw);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const form = new FormData();
  form.set('token', issued.token);
  form.set('key', issued.key);
  const filename = path.basename(filePath) || 'image';
  form.set('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  let uploaded: Response;
  try {
    uploaded = await fetchImpl(issued.uploadUrl, { method: 'POST', body: form });
  } catch (err) {
    throw new GatewayError(
      'NETWORK_ERROR',
      err instanceof Error ? err.message : '无法上传参考图',
      0,
    );
  }
  if (!uploaded.ok) {
    throw new GatewayError('UPSTREAM_ERROR', `参考图上传失败（${uploaded.status}）`, uploaded.status);
  }
  return issued.id;
}

export function createHostModels(deps: HostModelsDeps): HostModels {
  return {
    async list() {
      const raw = await deps.request('/v1/models', {
        method: 'GET',
        headers: pluginHeaders(deps.pluginId),
      });
      return parseModelsList(raw) as ModelsList;
    },
    billing: {
      async quote(body, options) {
        const raw = await deps.request('/v1/billing/quote', {
          method: 'POST',
          body: withoutPluginId(body),
          headers: pluginHeaders(deps.pluginId, options),
        });
        return parseBillingQuote(raw);
      },
    },
    chat: {
      completions: {
        async create(body, options) {
          return spendOrThrow(deps, async () => {
            await assertEntitled(deps);
            await quoteOrThrow(deps, quoteBodyForChat(body), options);
            return deps.request('/v1/chat/completions', {
              method: 'POST',
              body: withoutPluginId(body),
              headers: pluginHeaders(deps.pluginId, options),
            });
          });
        },
      },
    },
    images: {
      async generate(input: HostImageGenerateInput, options?: HostModelsCallOptions): Promise<HostImageGenerateResult> {
        return spendOrThrow(deps, async () => {
          await assertEntitled(deps);
          const model = typeof input?.model === 'string' ? input.model.trim() : '';
          const outputPath = typeof input?.outputPath === 'string' ? input.outputPath.trim() : '';
          const record = asRecord(input?.input);
          const prompt = record && typeof record.prompt === 'string' ? record.prompt.trim() : '';
          if (!model) throw new GatewayError('INVALID_BODY', '缺少 model', 400);
          if (!prompt) throw new GatewayError('INVALID_BODY', '缺少 prompt', 400);
          if (!outputPath || !path.isAbsolute(outputPath)) {
            throw new GatewayError('INVALID_BODY', 'outputPath 必须是绝对路径', 400);
          }
          await quoteOrThrow(deps, quoteBodyForImage(model), options);
          const localImages = readInputImages(record);
          const fileIds: string[] = [];
          for (let i = 0; i < localImages.length; i += 1) {
            const fileKey = options?.idempotencyKey
              ? { idempotencyKey: `${options.idempotencyKey}:file:${i}` }
              : options;
            fileIds.push(await uploadReference(deps, localImages[i], fileKey));
          }
          const generateBody: Record<string, unknown> = { model, prompt };
          if (record && typeof record.aspect_ratio === 'string' && record.aspect_ratio.trim() !== '') {
            generateBody.aspect_ratio = record.aspect_ratio.trim();
          }
          if (fileIds.length > 0) generateBody.fileIds = fileIds;
          const generatedRaw = await deps.request('/v1/images/generate', {
            method: 'POST',
            body: generateBody,
            headers: pluginHeaders(deps.pluginId, options),
          });
          const generated = parseImageGenerate(generatedRaw);
          const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
          let downloaded: Response;
          try {
            downloaded = await fetchImpl(generated.downloadUrl);
          } catch (err) {
            throw new GatewayError(
              'NETWORK_ERROR',
              err instanceof Error ? err.message : '无法下载生成图',
              0,
            );
          }
          if (!downloaded.ok) {
            throw new GatewayError('OUTPUT_EXPIRED', `生成图下载失败（${downloaded.status}）`, downloaded.status);
          }
          const bytes = Buffer.from(await downloaded.arrayBuffer());
          if (bytes.length === 0) {
            throw new GatewayError('BAD_RESPONSE', '生成图是空的', 502);
          }
          const mkdir = deps.mkdir ?? ((dir: string) => fs.mkdirSync(dir, { recursive: true }));
          const writeFile = deps.writeFile ?? ((file: string, data: Buffer) => fs.writeFileSync(file, data));
          mkdir(path.dirname(outputPath));
          writeFile(outputPath, bytes);
          return { status: 'succeeded' as const, output: outputPath, model: generated.model };
        });
      },
    },
  };
}
