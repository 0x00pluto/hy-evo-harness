import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const snippetJs = path.join(repoRoot, 'docs/plugin-development/snippets/dex-buddy-sdk.js');
const snippetStandaloneJs = path.join(repoRoot, 'docs/plugin-development/snippets/dex-buddy-standalone.js');
const snippetPy = path.join(repoRoot, 'docs/plugin-development/snippets/dex_buddy_sdk.py');
const snippetStandalonePy = path.join(repoRoot, 'docs/plugin-development/snippets/dex_buddy_standalone.py');
const playgroundJs = path.join(repoRoot, 'plugins/models-playground/lib/dex-buddy-sdk.js');
const playgroundStandaloneJs = path.join(repoRoot, 'plugins/models-playground/lib/dex-buddy-standalone.js');
const playgroundPy = path.join(repoRoot, 'plugins/models-playground/lib/dex_buddy_sdk.py');
const playgroundStandalonePy = path.join(repoRoot, 'plugins/models-playground/lib/dex_buddy_standalone.py');
const generatePy = path.join(repoRoot, 'plugins/models-playground/python/generate.py');
const { MISSING_KEY, SDK_VERSION, bindModels, childEnv, navigate, requireEntitlement } = require(playgroundJs);
const { STANDALONE_VERSION, createStandaloneModels } = require(playgroundStandaloneJs);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('snippets 与试玩插件里的 SDK 是同一份', () => {
  assert.equal(fs.readFileSync(snippetJs, 'utf8'), fs.readFileSync(playgroundJs, 'utf8'));
  assert.equal(fs.readFileSync(snippetStandaloneJs, 'utf8'), fs.readFileSync(playgroundStandaloneJs, 'utf8'));
  assert.equal(fs.readFileSync(snippetPy, 'utf8'), fs.readFileSync(playgroundPy, 'utf8'));
  assert.equal(fs.readFileSync(snippetStandalonePy, 'utf8'), fs.readFileSync(playgroundStandalonePy, 'utf8'));
});

test('SDK_VERSION 为 1.0.4，STANDALONE_VERSION 为 1.0.3', () => {
  assert.equal(SDK_VERSION, '1.0.4');
  assert.equal(STANDALONE_VERSION, '1.0.3');
});

test('接口层不含独立跑上传实现', () => {
  const facade = fs.readFileSync(snippetJs, 'utf8');
  assert.equal(facade.includes('createHash'), false);
  assert.equal(facade.includes(':file:'), false);
  assert.equal(facade.includes('/v1/files'), false);
  assert.equal(facade.includes('createStandaloneModels'), true);
  assert.equal(typeof createStandaloneModels, 'function');
});

test('Node SDK 在 checkJs + strict 下通过 tsc --noEmit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-sdk-tsc-'));
  const facadeCopy = path.join(root, 'dex-buddy-sdk.js');
  const standaloneCopy = path.join(root, 'dex-buddy-standalone.js');
  fs.copyFileSync(snippetJs, facadeCopy);
  fs.copyFileSync(snippetStandaloneJs, standaloneCopy);
  const configPath = path.join(root, 'tsconfig.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      compilerOptions: {
        allowJs: true,
        checkJs: true,
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'commonjs',
        types: ['node'],
        typeRoots: [path.join(repoRoot, 'node_modules/@types')],
      },
      files: [facadeCopy, standaloneCopy],
    }),
  );
  const result = spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', configPath], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: repoRoot,
  });
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stdout + result.stderr || String(result.error));
});

test('独立跑 requireEntitlement 直接通过，不抛登录或买断错误', async () => {
  await requireEntitlement(undefined);
  await requireEntitlement({});
  await requireEntitlement({ requireEntitlement: 'not-a-function' });
});

test('工作台 requireEntitlement 转交宿主且不传 id', async () => {
  const seen: unknown[][] = [];
  await requireEntitlement({
    requireEntitlement: (...args: unknown[]) => {
      seen.push(args);
    },
  });
  assert.deepEqual(seen, [[]]);
});

test('工作台 requireEntitlement 有第二参则转交', async () => {
  const seen: unknown[][] = [];
  const options = { pluginId: 'mock-on-sale', mockOwned: false };
  await requireEntitlement(
    {
      requireEntitlement: (...args: unknown[]) => {
        seen.push(args);
      },
    },
    options,
  );
  assert.deepEqual(seen, [[options]]);
});

test('独立跑 navigate 静默成功，不抛错', async () => {
  await navigate(undefined, 'dex://settings/self');
  await navigate({}, 'dex://settings/self#PLAYGROUND_NOTE');
  await navigate({ navigate: 'not-a-function' }, 'dex://settings/self');
});

test('工作台 navigate 转交宿主 href', async () => {
  const seen: unknown[] = [];
  await navigate(
    {
      navigate: (href: string) => {
        seen.push(href);
      },
    },
    'dex://settings/self#OPENAI_API_KEY',
  );
  assert.deepEqual(seen, ['dex://settings/self#OPENAI_API_KEY']);
});

test('有 ctx.models 时不打独立 HTTP、不读 Key', async () => {
  const calls: string[] = [];
  const host = {
    list: async () => ({ object: 'list', data: [{ id: 'dexbuddy-chat', object: 'model' }] }),
    billing: { quote: async () => ({ enough: true }) },
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: '宿主' } }] }),
      },
    },
    images: { generate: async () => ({ status: 'succeeded', output: '/tmp/x.png', model: 'dexbuddy-image' }) },
  };
  const models = bindModels(
    { models: host },
    {
      env: { DEX_BUDDY_API_KEY: 'dbh_sk_should_not_send' },
      fetch: async (url: string) => {
        calls.push(url);
        throw new Error('should not fetch');
      },
    },
  );
  const body = await models.chat.completions.create({
    model: 'dexbuddy-chat',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal((body as { choices: Array<{ message: { content: string } }> }).choices[0]?.message.content, '宿主');
  assert.deepEqual(calls, []);
});

test('独立跑缺 Key 时给出人话', async () => {
  const models = bindModels(null, { env: {}, fetch: async () => jsonResponse({}) });
  await assert.rejects(() => models.list(), (err: { code?: string; message?: string }) => {
    assert.equal(err.code, 'UNAUTHORIZED');
    assert.equal(err.message, MISSING_KEY);
    return true;
  });
});

test('独立跑用 API Key 打网关并盖清单 id', async () => {
  const seen: Array<{ url: string; auth?: string | null; plugin?: string | null; body?: unknown }> = [];
  const models = bindModels(null, {
    env: { DEX_BUDDY_API_KEY: 'dbh_sk_test' },
    pluginId: 'models-playground',
    baseUrl: 'https://www.dexbuddy.app',
    fetch: async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        auth: headers.get('Authorization'),
        plugin: headers.get('X-Plugin-Id'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/v1/chat/completions')) {
        return jsonResponse({
          id: 'chat-1',
          choices: [{ message: { role: 'assistant', content: '独立' } }],
        });
      }
      throw new Error(url);
    },
  });
  const body = await models.chat.completions.create({
    model: 'dexbuddy-chat',
    messages: [{ role: 'user', content: '你好' }],
  });
  assert.equal((body as { choices: Array<{ message: { content: string } }> }).choices[0]?.message.content, '独立');
  assert.equal(seen[0]?.auth, 'Bearer dbh_sk_test');
  assert.equal(seen[0]?.plugin, 'models-playground');
  assert.equal((seen[0]?.body as { model: string }).model, 'dexbuddy-chat');
});

test('独立跑生图把 downloadUrl 写到本地文件', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-sdk-'));
  const outputPath = path.join(root, 'out.png');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const models = bindModels(null, {
    env: { DEX_BUDDY_API_KEY: 'dbh_sk_test' },
    pluginId: 'models-playground',
    baseUrl: 'https://www.dexbuddy.app',
    fetch: async (url: string) => {
      if (url.endsWith('/v1/images/generate')) {
        return jsonResponse({
          downloadUrl: 'https://cdn.example/out.png',
          mediaType: 'image/png',
          expiresAt: '2099-01-01T00:00:00.000Z',
          model: 'dexbuddy-image',
        });
      }
      if (url === 'https://cdn.example/out.png') {
        return new Response(png, { status: 200 });
      }
      throw new Error(url);
    },
  });
  const result = await models.images.generate({
    model: 'dexbuddy-image',
    input: { prompt: '独角兽' },
    outputPath,
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output, outputPath);
  assert.equal(fs.readFileSync(outputPath).equals(png), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('独立跑默认参考图交 fileUrls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-sdk-'));
  const refPath = path.join(root, 'ref.png');
  const outputPath = path.join(root, 'out.png');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(refPath, png);
  /** @type {{ url: string; body?: unknown; headers?: HeadersInit }[]} */
  const seen: { url: string; body?: unknown; headers?: HeadersInit }[] = [];
  const models = bindModels(null, {
    env: { DEX_BUDDY_API_KEY: 'dbh_sk_test' },
    pluginId: 'models-playground',
    baseUrl: 'https://www.dexbuddy.app',
    fetch: async (url: string, init?: RequestInit) => {
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      seen.push({ url, body, headers: init?.headers });
      if (url.endsWith('/v1/files')) {
        return jsonResponse({
          id: 'file-1',
          key: 'refs/u1/a.png',
          uploadUrl: 'https://upload.example/put',
          token: 'tok',
          expiresAt: '2099-01-01T00:00:00.000Z',
          downloadUrl: 'https://cdn.example/ref.png?e=1&token=sig',
        });
      }
      if (url === 'https://upload.example/put') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/v1/images/generate')) {
        return jsonResponse({
          downloadUrl: 'https://cdn.example/out.png',
          mediaType: 'image/png',
          expiresAt: '2099-01-01T00:00:00.000Z',
          model: 'dexbuddy-image',
        });
      }
      if (url === 'https://cdn.example/out.png') {
        return new Response(png, { status: 200 });
      }
      throw new Error(url);
    },
  });
  await models.images.generate({
    model: 'dexbuddy-image',
    input: { prompt: '独角兽', input_images: [refPath] },
    outputPath,
  });
  const generate = seen.find((item) => item.url.endsWith('/v1/images/generate'));
  assert.deepEqual(generate?.body, {
    model: 'dexbuddy-image',
    prompt: '独角兽',
    fileUrls: ['https://cdn.example/ref.png?e=1&token=sig'],
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('独立跑参考图文件键按内容哈希，不跟成图键', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-sdk-'));
  const refPath = path.join(root, 'ref.png');
  const outputPath = path.join(root, 'out.png');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const expectedFileKey = `ref:${crypto.createHash('sha256').update(png).digest('hex')}`;
  fs.writeFileSync(refPath, png);
  /** @type {{ url: string; headers?: HeadersInit }[]} */
  const seen: { url: string; headers?: HeadersInit }[] = [];
  const models = bindModels(null, {
    env: { DEX_BUDDY_API_KEY: 'dbh_sk_test' },
    pluginId: 'models-playground',
    baseUrl: 'https://www.dexbuddy.app',
    fetch: async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers });
      if (url.endsWith('/v1/files')) {
        return jsonResponse({
          id: 'file-1',
          key: 'refs/u1/a.png',
          uploadUrl: 'https://upload.example/put',
          token: 'tok',
          expiresAt: '2099-01-01T00:00:00.000Z',
          downloadUrl: 'https://cdn.example/ref.png?e=1&token=sig',
        });
      }
      if (url === 'https://upload.example/put') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/v1/images/generate')) {
        return jsonResponse({
          downloadUrl: 'https://cdn.example/out.png',
          mediaType: 'image/png',
          expiresAt: '2099-01-01T00:00:00.000Z',
          model: 'dexbuddy-image',
        });
      }
      if (url === 'https://cdn.example/out.png') {
        return new Response(png, { status: 200 });
      }
      throw new Error(url);
    },
  });
  await models.images.generate(
    {
      model: 'dexbuddy-image',
      input: { prompt: '独角兽', input_images: [refPath] },
      outputPath,
    },
    { idempotencyKey: 'note-42:slot-1:gen-1' },
  );
  const files = seen.find((item) => item.url.endsWith('/v1/files'));
  const generate = seen.find((item) => item.url.endsWith('/v1/images/generate'));
  const fileHeaders = files?.headers as Record<string, string> | undefined;
  const generateHeaders = generate?.headers as Record<string, string> | undefined;
  assert.equal(fileHeaders?.['Idempotency-Key'], expectedFileKey);
  assert.equal(String(fileHeaders?.['Idempotency-Key'] || '').includes(':file:'), false);
  assert.equal(generateHeaders?.['Idempotency-Key'], 'note-42:slot-1:gen-1');
  fs.rmSync(root, { recursive: true, force: true });
});

test('独立跑 referenceUpload direct 交 fileIds', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-sdk-'));
  const refPath = path.join(root, 'ref.png');
  const outputPath = path.join(root, 'out.png');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(refPath, png);
  const seen: { url: string; body?: unknown }[] = [];
  const models = bindModels(null, {
    env: { DEX_BUDDY_API_KEY: 'dbh_sk_test' },
    pluginId: 'models-playground',
    baseUrl: 'https://www.dexbuddy.app',
    fetch: async (url: string, init?: RequestInit) => {
      const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      seen.push({ url, body });
      if (url.endsWith('/v1/files')) {
        return jsonResponse({
          id: 'file-2',
          key: 'refs/u1/b.png',
          uploadUrl: 'https://upload.example/put',
          token: 'tok',
          expiresAt: '2099-01-01T00:00:00.000Z',
        });
      }
      if (url === 'https://upload.example/put') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/v1/images/generate')) {
        return jsonResponse({
          downloadUrl: 'https://cdn.example/out.png',
          mediaType: 'image/png',
          expiresAt: '2099-01-01T00:00:00.000Z',
          model: 'dexbuddy-image',
        });
      }
      if (url === 'https://cdn.example/out.png') {
        return new Response(png, { status: 200 });
      }
      throw new Error(url);
    },
  });
  await models.images.generate(
    {
      model: 'dexbuddy-image',
      input: { prompt: '独角兽', input_images: [refPath] },
      outputPath,
    },
    { referenceUpload: 'direct' },
  );
  const generate = seen.find((item) => item.url.endsWith('/v1/images/generate'));
  assert.deepEqual(generate?.body, {
    model: 'dexbuddy-image',
    prompt: '独角兽',
    fileIds: ['file-2'],
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('childEnv 丢掉 Key、代理文案，并把 Idempotency-Key 交给生图', async () => {
  /** @type {{ input: unknown; options: unknown }[]} */
  const imageCalls = [];
  const host = {
    list: async () => ({ object: 'list', data: [{ id: 'dexbuddy-chat', object: 'model' }] }),
    billing: { quote: async () => ({ enough: true }) },
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: '代理' } }] }),
      },
    },
    images: {
      generate: async (input: unknown, options?: unknown) => {
        imageCalls.push({ input, options });
        return { status: 'succeeded', output: '/tmp/x.png', model: 'dexbuddy-image' };
      },
    },
  };
  const env = await childEnv(
    { models: host },
    {
      DEX_BUDDY_API_KEY: 'dbh_sk_secret',
      PATH: process.env.PATH || '',
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      ALL_PROXY: 'http://127.0.0.1:9',
      http_proxy: 'http://127.0.0.1:9',
      https_proxy: 'http://127.0.0.1:9',
      all_proxy: 'http://127.0.0.1:9',
    },
  );
  assert.equal(env.DEX_BUDDY_API_KEY, undefined);
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.ALL_PROXY, undefined);
  assert.equal(env.http_proxy, undefined);
  assert.equal(env.https_proxy, undefined);
  assert.equal(env.all_proxy, undefined);
  assert.equal(env.NO_PROXY, '127.0.0.1,localhost');
  assert.equal(env.no_proxy, '127.0.0.1,localhost');
  assert.match(String(env.DEX_BUDDY_MODELS_URL), /^http:\/\/127\.0\.0\.1:\d+$/);
  const response = await fetch(`${env.DEX_BUDDY_MODELS_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'dexbuddy-chat', messages: [] }),
  });
  const body = await response.json();
  assert.equal(body.choices[0].message.content, '代理');

  const imageResponse = await fetch(`${env.DEX_BUDDY_MODELS_URL}/images/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'note-42:slot-1:gen-1',
    },
    body: JSON.stringify({
      model: 'dexbuddy-image',
      input: { prompt: '独角兽' },
      outputPath: '/tmp/x.png',
    }),
  });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageCalls.length, 1);
  assert.deepEqual(imageCalls[0]?.options, { idempotencyKey: 'note-42:slot-1:gen-1' });
});

test('Python SDK 能被编译且 require_entitlement 直接通过', (t) => {
  const result = spawnSync('python3', ['-m', 'py_compile', playgroundPy], {
    encoding: 'utf8',
    timeout: 8000,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    t.skip('本机没有 python3');
    return;
  }
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const run = spawnSync(
    'python3',
    [
      '-c',
      'from dex_buddy_sdk import require_entitlement, navigate, __version__; require_entitlement(); navigate("dex://settings/self"); print(__version__)',
    ],
    { encoding: 'utf8', timeout: 8000, cwd: path.dirname(playgroundPy) },
  );
  assert.equal(run.status, 0, run.stderr || String(run.error));
  assert.equal(run.stdout.trim(), '1.0.4');
});

function skipWithoutPython(t: { skip: (reason?: string) => void }): boolean {
  const probe = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8', timeout: 8000 });
  if (probe.error && (probe.error as NodeJS.ErrnoException).code === 'ENOENT') {
    t.skip('本机没有 python3');
    return true;
  }
  return false;
}

function pythonEnv(port: number, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.DEX_BUDDY_MODELS_URL;
  env.DEX_BUDDY_API_KEY = extra.DEX_BUDDY_API_KEY || 'dbh_sk_test';
  env.DEX_GATEWAY_BASE_URL = `http://127.0.0.1:${port}`;
  return env;
}

function runPython(
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, {
      cwd: options.cwd,
      env: options.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('python 超时'));
    }, options.timeoutMs ?? 8000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(options.input ?? '');
  });
}

function listenStub(
  onRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(onRequest);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('无法监听本机桩'));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
            if (typeof server.closeAllConnections === 'function') {
              server.closeAllConnections();
            }
          }),
      });
    });
    server.on('error', reject);
  });
}

test('Python SDK 独立跑盖清单 id', async (t) => {
  if (skipWithoutPython(t)) return;
  const seen: Array<{ url?: string; plugin?: string | string[] | undefined }> = [];
  const stub = await listenStub((req, res) => {
    seen.push({ url: req.url, plugin: req.headers['x-plugin-id'] });
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'dexbuddy-chat', kind: 'chat' }] }));
  });
  try {
    const run = await runPython(
      ['-c', 'from dex_buddy_sdk import bind_models; print(bind_models().list()["data"][0]["id"])'],
      {
        cwd: path.dirname(playgroundPy),
        env: pythonEnv(stub.port),
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), 'dexbuddy-chat');
    assert.equal(seen[0]?.plugin, 'models-playground');
  } finally {
    await stub.close();
  }
});

test('Python SDK 读超时收成中文 DexModelsError', async (t) => {
  if (skipWithoutPython(t)) return;
  const stub = await listenStub((req) => {
    req.resume();
  });
  try {
    const run = await runPython(
      [
        '-c',
        [
          'from dex_buddy_sdk import DexModelsError, bind_models',
          'try:',
          '    bind_models().chat.completions.create({"model": "dexbuddy-chat", "messages": []})',
          'except DexModelsError as err:',
          '    print(f"{type(err).__name__}:{err.code}:{err}", end="")',
          '    raise SystemExit(1)',
        ].join('\n'),
      ],
      {
        cwd: path.dirname(playgroundPy),
        env: pythonEnv(stub.port, { DEX_BUDDY_HTTP_TIMEOUT: '1' }),
      },
    );
    assert.notEqual(run.status, 0);
    const output = `${run.stdout}${run.stderr}`;
    assert.match(output, /DexModelsError:NETWORK_ERROR:网关读取超时（已等待 1 秒）/);
    assert.doesNotMatch(output, /The read operation timed out/);
  } finally {
    await stub.close();
  }
});

test('试玩插件 Python 超时只打一行中文', async (t) => {
  if (skipWithoutPython(t)) return;
  const stub = await listenStub((req, res) => {
    req.resume();
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'dexbuddy-chat', kind: 'chat' }] }));
      return;
    }
  });
  try {
    const run = await runPython([generatePy], {
      input: JSON.stringify({ kind: 'chat', prompt: 'hi' }),
      env: pythonEnv(stub.port, { DEX_BUDDY_HTTP_TIMEOUT: '1' }),
    });
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stdout.trim(), '');
    assert.equal(run.stderr.trim(), '网关读取超时（已等待 1 秒）');
    assert.doesNotMatch(run.stderr, /Traceback|TimeoutError|The read operation timed out/);
  } finally {
    await stub.close();
  }
});
