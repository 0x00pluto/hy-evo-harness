// @ts-check
'use strict';

/**
 * Dex Buddy 插件 SDK 接口层 1.0.4。拷进插件 lib/ 后：
 * 工作台走宿主校验与 ctx.models；独立跑再拷同目录的 dex-buddy-standalone.js，用 DEX_BUDDY_API_KEY（开发者付钱）。
 * SDK_VERSION 只表示对外契约；契约没变就不必再拷本文件。不要把 Key 写进设置或 zip。
 */

const SDK_VERSION = '1.0.4';

const http = require('node:http');

const DEFAULT_BASE = 'https://www.dexbuddy.app';
const MISSING_KEY =
  '独立运行需要环境变量 DEX_BUDDY_API_KEY（账号里的用户 API Key，dbh_sk_ 开头）。写进本机 .env，不要放进插件设置，也不要打进 zip。装进 Dex Buddy 后会改走宿主，扣使用者的积分。';

class DexModelsError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'DexModelsError';
    this.code = code;
    this.status = typeof status === 'number' ? status : 0;
  }
}

/** @type {Promise<string> | null} */
let proxyUrlPromise = null;

/**
 * @typedef {{
 *   list: () => Promise<unknown>;
 *   billing: { quote: (body?: unknown, options?: { idempotencyKey?: string }) => Promise<unknown> };
 *   chat: { completions: { create: (body?: unknown, options?: { idempotencyKey?: string }) => Promise<unknown> } };
 *   images: { generate: (input?: unknown, options?: { idempotencyKey?: string }) => Promise<unknown> };
 * }} HostModels
 */

/**
 * @param {unknown} ctx
 * @returns {HostModels | null}
 */
function hostModels(ctx) {
  const models = ctx && typeof ctx === 'object' ? /** @type {{ models?: HostModels }} */ (ctx).models : null;
  const create = models && models.chat && models.chat.completions && models.chat.completions.create;
  return typeof create === 'function' && models ? models : null;
}

/**
 * @param {unknown} ctx
 * @param {Record<string, unknown> | null} [options]
 * @returns {HostModels}
 */
function bindModels(ctx, options) {
  const host = hostModels(ctx);
  if (host) return host;
  // 懒加载，避免与 standalone 顶层互相 require。
  const { createStandaloneModels } = require('./dex-buddy-standalone');
  return createStandaloneModels(options || undefined);
}

/**
 * 工作台转交宿主买断确认；独立跑直接通过。正式作者不要传第二参。
 * @param {unknown} ctx
 * @param {unknown} [options]
 */
async function requireEntitlement(ctx, options) {
  const fn =
    ctx && typeof ctx === 'object'
      ? /** @type {{ requireEntitlement?: unknown }} */ (ctx).requireEntitlement
      : null;
  if (typeof fn === 'function') {
    if (arguments.length > 1) return fn(options);
    return fn();
  }
}

/**
 * 工作台转交宿主打开设置等页面；独立跑无界面，静默成功（不跳页、不报错）。
 * 地址见 docs/plugin-development/navigate.md。不要直接写 ctx.navigate（独立跑没有该字段）。
 * @param {unknown} ctx
 * @param {string} href
 */
async function navigate(ctx, href) {
  const fn =
    ctx && typeof ctx === 'object' ? /** @type {{ navigate?: unknown }} */ (ctx).navigate : null;
  if (typeof fn === 'function') return fn(href);
}

/**
 * @param {http.IncomingMessage} req
 * @returns {{ idempotencyKey?: string } | undefined}
 */
function callOptionsFromReq(req) {
  const raw = req.headers['idempotency-key'];
  const key = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) ? String(raw[0] || '').trim() : '';
  if (!key) return undefined;
  return { idempotencyKey: key };
}

/**
 * @param {unknown} ctx
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {unknown} body
 */
async function handleProxy(ctx, req, res, body) {
  const models = hostModels(ctx);
  if (!models) {
    res.statusCode = 401;
    res.end(JSON.stringify({ code: 'UNAUTHORIZED', error: '宿主模型不可用' }));
    return;
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const callOptions = callOptionsFromReq(req);
  let result;
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    result = await models.list();
  } else if (req.method === 'POST' && url.pathname === '/v1/billing/quote') {
    result = await models.billing.quote(body, callOptions);
  } else if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    result = await models.chat.completions.create(body, callOptions);
  } else if (req.method === 'POST' && url.pathname === '/images/generate') {
    result = await models.images.generate(body, callOptions);
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ code: 'BAD_RESPONSE', error: '未知路径' }));
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result));
}

/**
 * 工作台里给 Python 子进程用：指向本机代理，并删掉开发者 Key。
 * @param {unknown} ctx
 * @param {NodeJS.ProcessEnv} [baseEnv]
 */
function childEnv(ctx, baseEnv) {
  const env = { ...(baseEnv || process.env) };
  delete env.DEX_BUDDY_API_KEY;
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.all_proxy;
  env.NO_PROXY = '127.0.0.1,localhost';
  env.no_proxy = '127.0.0.1,localhost';
  const host = hostModels(ctx);
  if (!host) return Promise.resolve(env);
  if (!proxyUrlPromise) {
    proxyUrlPromise = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        req.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        req.on('end', () => {
          let parsed = null;
          const raw = Buffer.concat(chunks).toString('utf8');
          if (raw.trim() !== '') {
            try {
              parsed = JSON.parse(raw);
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ code: 'INVALID_BODY', error: 'JSON 无效' }));
              return;
            }
          }
          handleProxy(ctx, req, res, parsed).catch((err) => {
            const code = err && typeof err.code === 'string' ? err.code : 'SERVER_ERROR';
            const status = err && typeof err.status === 'number' && err.status >= 400 ? err.status : 500;
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code, error: err instanceof Error ? err.message : '代理失败' }));
          });
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('无法监听本机代理'));
          return;
        }
        server.unref();
        resolve(`http://127.0.0.1:${address.port}`);
      });
      server.on('error', reject);
    });
  }
  return proxyUrlPromise.then((url) => {
    env.DEX_BUDDY_MODELS_URL = url;
    return env;
  });
}

module.exports = {
  DEFAULT_BASE,
  MISSING_KEY,
  DexModelsError,
  bindModels,
  requireEntitlement,
  navigate,
  childEnv,
  SDK_VERSION,
};
