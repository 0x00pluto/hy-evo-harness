// @ts-check
'use strict';

/**
 * Dex Buddy 独立跑默认实现 STANDALONE_VERSION 1.0.3。
 * 与宿主 host-egress 行为对齐；只在本机用 DEX_BUDDY_API_KEY 开发时需要。
 * 工作台走宿主，不必拷本文件。实现细节变更只升 STANDALONE_VERSION，不强迫改接口 SDK_VERSION。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { DexModelsError, DEFAULT_BASE, MISSING_KEY } = require('./dex-buddy-sdk');

const STANDALONE_VERSION = '1.0.3';

/**
 * @typedef {{
 *   list: () => Promise<unknown>;
 *   billing: { quote: (body?: unknown, options?: { idempotencyKey?: string }) => Promise<unknown> };
 *   chat: { completions: { create: (body?: unknown, options?: { idempotencyKey?: string }) => Promise<unknown> } };
 *   images: { generate: (input?: unknown, options?: { idempotencyKey?: string }) => Promise<unknown> };
 * }} HostModels
 */

function missingKey() {
  return new DexModelsError('UNAUTHORIZED', MISSING_KEY, 401);
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function trimString(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * @param {Record<string, unknown> | null | undefined} [options]
 */
function resolvePluginId(options) {
  const fromOptions = trimString(options && /** @type {{ pluginId?: string }} */ (options).pluginId);
  if (fromOptions) return fromOptions;
  const explicit = trimString(options && /** @type {{ manifestPath?: string }} */ (options).manifestPath);
  const candidates = [
    explicit,
    path.join(__dirname, '..', 'plugin.manifest.json'),
    path.join(__dirname, 'plugin.manifest.json'),
  ];
  for (const file of candidates) {
    if (!file || !fs.existsSync(file)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const id = parsed && typeof parsed.id === 'string' ? parsed.id.trim() : '';
      if (id) return id;
    } catch {
      // 清单读失败时不盖 id，网关头仍可选。
    }
  }
  return '';
}

/**
 * @param {unknown} body
 * @param {number} status
 */
function errorFromBody(body, status) {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? /** @type {Record<string, unknown>} */ (body) : null;
  const nested = record && record.error && typeof record.error === 'object' ? /** @type {Record<string, unknown>} */ (record.error) : null;
  if (nested && typeof nested.message === 'string' && nested.message.trim() !== '') {
    const code = typeof nested.code === 'string' && nested.code.trim() !== '' ? nested.code : 'BAD_RESPONSE';
    return new DexModelsError(code, nested.message, status);
  }
  const code = record && typeof record.code === 'string' && record.code.trim() !== '' ? record.code : 'BAD_RESPONSE';
  const message =
    record && typeof record.error === 'string' && record.error.trim() !== ''
      ? record.error
      : `网关请求失败（${status}）`;
  return new DexModelsError(code, message, status);
}

/**
 * @param {string} filePath
 */
function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

/**
 * @param {Record<string, unknown> | null | undefined} options
 * @returns {HostModels}
 */
function createStandaloneModels(options) {
  const env = /** @type {NodeJS.ProcessEnv} */ ((options && options.env) || process.env);
  const fetchImpl =
    /** @type {(input: string, init?: RequestInit) => Promise<Response>} */ (
      (options && options.fetch) || globalThis.fetch.bind(globalThis)
    );
  const baseUrl = String((options && options.baseUrl) || env.DEX_GATEWAY_BASE_URL || DEFAULT_BASE).replace(
    /\/+$/,
    '',
  );
  const pluginId = resolvePluginId(options);

  /**
   * @param {string} requestPath
   * @param {{ method: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> }} init
   */
  async function request(requestPath, init) {
    const key = trimString(env.DEX_BUDDY_API_KEY);
    if (!key) throw missingKey();
    /** @type {Record<string, string>} */
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      ...(pluginId ? { 'X-Plugin-Id': pluginId } : {}),
      ...(init.headers || {}),
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const extra = init.headers && init.headers['Idempotency-Key'];
    if (extra) headers['Idempotency-Key'] = extra;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${requestPath.startsWith('/') ? requestPath : `/${requestPath}`}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw new DexModelsError('NETWORK_ERROR', err instanceof Error ? err.message : '无法连接网关', 0);
    }
    let parsed = null;
    const text = await response.text();
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new DexModelsError('BAD_RESPONSE', '网关返回了无法解析的响应', response.status);
      }
    }
    if (!response.ok) throw errorFromBody(parsed, response.status);
    return parsed;
  }

  /**
   * @param {{ idempotencyKey?: string }} [callOptions]
   * @returns {Record<string, string>}
   */
  function extraHeaders(callOptions) {
    const key = callOptions && typeof callOptions.idempotencyKey === 'string' ? callOptions.idempotencyKey.trim() : '';
    /** @type {Record<string, string>} */
    const headers = {};
    if (key) headers['Idempotency-Key'] = key;
    return headers;
  }

  /**
   * @param {{ idempotencyKey?: string; referenceUpload?: string }} [callOptions]
   * @returns {'signed' | 'direct'}
   */
  function resolveReferenceUpload(callOptions) {
    const mode = callOptions && callOptions.referenceUpload;
    if (mode === undefined || mode === 'signed') return 'signed';
    if (mode === 'direct') return 'direct';
    throw new DexModelsError('INVALID_BODY', 'referenceUpload 只能是 signed 或 direct', 400);
  }

  /**
   * 参考图按字节复用；不带帖子 id、槽位或 gen。
   * @param {Buffer} bytes
   */
  function referenceIdempotencyKey(bytes) {
    return `ref:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
  }

  /**
   * @param {string} filePath
   * @param {'signed' | 'direct'} referenceUpload
   */
  async function uploadReference(filePath, referenceUpload) {
    const bytes = fs.readFileSync(filePath);
    if (!bytes || bytes.length === 0) {
      throw new DexModelsError('INVALID_BODY', `参考图是空的：${filePath}`, 400);
    }
    const contentType = mimeFromPath(filePath);
    const issued = await request('/v1/files', {
      method: 'POST',
      body: { contentType, contentLength: bytes.length },
      headers: extraHeaders({ idempotencyKey: referenceIdempotencyKey(bytes) }),
    });
    if (
      !issued ||
      typeof issued.uploadUrl !== 'string' ||
      typeof issued.token !== 'string' ||
      typeof issued.key !== 'string' ||
      typeof issued.id !== 'string' ||
      issued.id.trim() === ''
    ) {
      throw new DexModelsError('BAD_RESPONSE', '网关 files 凭证无效', 502);
    }
    const form = new FormData();
    form.set('token', issued.token);
    form.set('key', issued.key);
    form.set('file', new Blob([bytes], { type: contentType }), path.basename(filePath) || 'image');
    let uploaded;
    try {
      uploaded = await fetchImpl(issued.uploadUrl, { method: 'POST', body: form });
    } catch (err) {
      throw new DexModelsError('NETWORK_ERROR', err instanceof Error ? err.message : '无法上传参考图', 0);
    }
    if (!uploaded.ok) {
      throw new DexModelsError('UPSTREAM_ERROR', `参考图上传失败（${uploaded.status}）`, uploaded.status);
    }
    return issued;
  }

  return {
    async list() {
      return request('/v1/models', { method: 'GET' });
    },
    billing: {
      /**
       * @param {unknown} body
       * @param {{ idempotencyKey?: string }} [callOptions]
       */
      quote(body, callOptions) {
        return request('/v1/billing/quote', {
          method: 'POST',
          body,
          headers: extraHeaders(callOptions),
        });
      },
    },
    chat: {
      completions: {
        /**
         * @param {unknown} body
         * @param {{ idempotencyKey?: string }} [callOptions]
         */
        create(body, callOptions) {
          return request('/v1/chat/completions', {
            method: 'POST',
            body,
            headers: extraHeaders(callOptions),
          });
        },
      },
    },
    images: {
      /**
       * @param {unknown} input
       * @param {{ idempotencyKey?: string; referenceUpload?: string }} [callOptions]
       */
      async generate(input, callOptions) {
        const payload = input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {};
        const model = trimString(payload.model);
        const outputPath = trimString(payload.outputPath);
        const record = payload.input && typeof payload.input === 'object'
          ? /** @type {Record<string, unknown>} */ (payload.input)
          : {};
        const prompt = trimString(record.prompt);
        if (!model) throw new DexModelsError('INVALID_BODY', '缺少 model', 400);
        if (!prompt) throw new DexModelsError('INVALID_BODY', '缺少 prompt', 400);
        if (!outputPath || !path.isAbsolute(outputPath)) {
          throw new DexModelsError('INVALID_BODY', 'outputPath 必须是绝对路径', 400);
        }
        const rawImages = record.input_images;
        /** @type {string[]} */
        const localImages = [];
        if (Array.isArray(rawImages)) {
          for (const item of rawImages) {
            if (typeof item === 'string' && item.trim() !== '') localImages.push(item.trim());
          }
        }
        const referenceUpload = localImages.length > 0 ? resolveReferenceUpload(callOptions) : 'signed';
        /** @type {string[]} */
        const fileIds = [];
        /** @type {string[]} */
        const fileUrls = [];
        for (const localPath of localImages) {
          const issued = await uploadReference(localPath, referenceUpload);
          if (referenceUpload === 'direct') {
            fileIds.push(String(issued.id));
            continue;
          }
          const downloadUrl = typeof issued.downloadUrl === 'string' ? issued.downloadUrl.trim() : '';
          if (!downloadUrl) {
            throw new DexModelsError('BAD_RESPONSE', '网关 files 凭证缺少 downloadUrl', 502);
          }
          fileUrls.push(downloadUrl);
        }
        /** @type {{ model: string; prompt: string; aspect_ratio?: string; fileIds?: string[]; fileUrls?: string[] }} */
        const generateBody = { model, prompt };
        if (trimString(record.aspect_ratio)) generateBody.aspect_ratio = trimString(record.aspect_ratio);
        if (fileUrls.length > 0) generateBody.fileUrls = fileUrls;
        if (fileIds.length > 0) generateBody.fileIds = fileIds;
        const generated = await request('/v1/images/generate', {
          method: 'POST',
          body: generateBody,
          headers: extraHeaders(callOptions),
        });
        if (!generated || typeof generated.downloadUrl !== 'string' || generated.downloadUrl.trim() === '') {
          throw new DexModelsError('BAD_RESPONSE', '网关生图结果无效', 502);
        }
        let downloaded;
        try {
          downloaded = await fetchImpl(generated.downloadUrl);
        } catch (err) {
          throw new DexModelsError('NETWORK_ERROR', err instanceof Error ? err.message : '无法下载生成图', 0);
        }
        if (!downloaded.ok) {
          throw new DexModelsError('OUTPUT_EXPIRED', `生成图下载失败（${downloaded.status}）`, downloaded.status);
        }
        const bytes = Buffer.from(await downloaded.arrayBuffer());
        if (bytes.length === 0) throw new DexModelsError('BAD_RESPONSE', '生成图是空的', 502);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, bytes);
        return {
          status: 'succeeded',
          output: outputPath,
          model: typeof generated.model === 'string' ? generated.model : model,
        };
      },
    },
  };
}

module.exports = {
  STANDALONE_VERSION,
  createStandaloneModels,
};
