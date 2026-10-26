import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GatewayError } from '../src/main/gateway-client.ts';
import { createHostModels, type HostModelsDeps } from '../src/main/host-egress.ts';

interface RecordedCall {
  path: string;
  init: {
    method: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
  };
}

function chatOk() {
  return {
    id: 'chat-1',
    object: 'chat.completion',
    choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }],
  };
}

function quoteOk(enough = true) {
  return {
    kind: 'chat',
    estimate: '0.1000',
    enough,
    balance: enough ? '10.0000' : '0.0000',
    model: 'dexbuddy-chat',
  };
}

function makeModels(
  handler: (call: RecordedCall) => unknown,
  rights?: { shop?: string[]; owned?: string[] },
): { models: ReturnType<typeof createHostModels>; calls: RecordedCall[]; deps: HostModelsDeps } {
  const calls: RecordedCall[] = [];
  const deps: HostModelsDeps = {
    pluginId: 'app-dexbuddy-xiaohongshu',
    request: async (requestPath, init) => {
      const call = { path: requestPath, init };
      calls.push(call);
      return handler(call);
    },
    shopPluginIds: async () => rights?.shop ?? ['app-dexbuddy-xiaohongshu'],
    activeEntitlements: async () => rights?.owned ?? ['app-dexbuddy-xiaohongshu'],
  };
  return { models: createHostModels(deps), calls, deps };
}

test('chat.completions.create 盖清单 id，并从 body 去掉 pluginId', async () => {
  const { models, calls } = makeModels((call) => {
    if (call.path === '/v1/billing/quote') return quoteOk();
    if (call.path === '/v1/chat/completions') return chatOk();
    throw new Error(call.path);
  });
  const body = await models.chat.completions.create(
    {
      model: 'dexbuddy-chat',
      messages: [{ role: 'user', content: '写一篇' }],
      pluginId: 'should-not-be-sent',
      temperature: 0.7,
    },
    { idempotencyKey: 'draft-1:copy' },
  );
  assert.equal((body as { id: string }).id, 'chat-1');
  const chat = calls.find((item) => item.path === '/v1/chat/completions');
  assert.ok(chat);
  assert.equal(chat.init.headers?.['X-Plugin-Id'], 'app-dexbuddy-xiaohongshu');
  assert.equal(chat.init.headers?.['Idempotency-Key'], 'draft-1:copy');
  const sent = chat.init.body as Record<string, unknown>;
  assert.equal(sent.pluginId, undefined);
  assert.equal(sent.model, 'dexbuddy-chat');
  assert.equal(sent.temperature, 0.7);
});

test('商城插件未买断时不转发文案', async () => {
  const { models, calls } = makeModels(
    () => {
      throw new Error('should not request');
    },
    { shop: ['app-dexbuddy-xiaohongshu'], owned: [] },
  );
  await assert.rejects(
    () =>
      models.chat.completions.create({
        messages: [{ role: 'user', content: 'hi' }],
      }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.equal(calls.length, 0);
});

test('普通 id 不在商城时不查买断，仍可烧积分', async () => {
  const calls: RecordedCall[] = [];
  const models = createHostModels({
    pluginId: 'my-tool',
    shopPluginIds: async () => ['app-dexbuddy-xiaohongshu'],
    activeEntitlements: async () => [],
    request: async (requestPath, init) => {
      calls.push({ path: requestPath, init });
      if (requestPath === '/v1/billing/quote') return quoteOk();
      if (requestPath === '/v1/chat/completions') return chatOk();
      throw new Error(requestPath);
    },
  });
  await models.chat.completions.create({
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.ok(calls.some((item) => item.path === '/v1/chat/completions'));
  assert.equal(
    calls.find((item) => item.path === '/v1/chat/completions')?.init.headers?.['X-Plugin-Id'],
    'my-tool',
  );
});

test('报价不够时不打补全', async () => {
  const { models, calls } = makeModels((call) => {
    if (call.path === '/v1/billing/quote') return quoteOk(false);
    throw new Error(call.path);
  });
  await assert.rejects(
    () =>
      models.chat.completions.create({
        messages: [{ role: 'user', content: 'hi' }],
      }),
    (err: unknown) => err instanceof GatewayError && err.code === 'INSUFFICIENT_CREDITS',
  );
  assert.equal(calls.some((item) => item.path === '/v1/chat/completions'), false);
});

test('list 与 quote 不拦未买断的商城插件', async () => {
  const { models, calls } = makeModels(
    (call) => {
      if (call.path === '/v1/models') {
        return { object: 'list', data: [{ id: 'dexbuddy-chat', object: 'model', kind: 'chat' }] };
      }
      if (call.path === '/v1/billing/quote') return quoteOk();
      throw new Error(call.path);
    },
    { shop: ['app-dexbuddy-xiaohongshu'], owned: [] },
  );
  const listed = await models.list();
  assert.equal((listed as { data: Array<{ id: string }> }).data[0]?.id, 'dexbuddy-chat');
  const quoted = await models.billing.quote({
    model: 'dexbuddy-chat',
    messages: [{ role: 'user', content: 'hi' }],
    pluginId: 'ignored',
  });
  assert.equal((quoted as { enough: boolean }).enough, true);
  assert.equal(calls.some((item) => item.path === '/v1/chat/completions'), false);
});

test('images.generate 用 Replicate input 字段，结果落到本地，不把 downloadUrl 交给插件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-img-'));
  const ref = path.join(dir, 'ref.png');
  const outputPath = path.join(dir, 'out', 'result.png');
  fs.writeFileSync(ref, Buffer.from('ref-bytes'));
  const calls: RecordedCall[] = [];
  const fetched: string[] = [];
  const models = createHostModels({
    pluginId: 'app-dexbuddy-xiaohongshu',
    shopPluginIds: async () => ['app-dexbuddy-xiaohongshu'],
    activeEntitlements: async () => ['app-dexbuddy-xiaohongshu'],
    request: async (requestPath, init) => {
      calls.push({ path: requestPath, init });
      if (requestPath === '/v1/billing/quote') {
        return {
          kind: 'image',
          estimate: '1.0000',
          enough: true,
          balance: '10.0000',
          model: 'dexbuddy-image',
          creditsPerImage: '1.0000',
        };
      }
      if (requestPath === '/v1/files') {
        return {
          id: 'file-1',
          key: 'refs/file-1.png',
          uploadUrl: 'https://upload.example/put',
          token: 'upload-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
        };
      }
      if (requestPath === '/v1/images/generate') {
        const body = init.body as Record<string, unknown>;
        assert.equal(body.model, 'dexbuddy-image');
        assert.equal(body.prompt, '一只猫');
        assert.equal(body.aspect_ratio, '3:4');
        assert.deepEqual(body.fileIds, ['file-1']);
        return {
          downloadUrl: 'https://cdn.example/out.png',
          mediaType: 'image/png',
          expiresAt: '2099-01-01T00:00:00.000Z',
          model: 'dexbuddy-image',
        };
      }
      throw new Error(requestPath);
    },
    fetchImpl: async (input) => {
      fetched.push(String(input));
      if (String(input) === 'https://upload.example/put') {
        return new Response('', { status: 200 });
      }
      if (String(input) === 'https://cdn.example/out.png') {
        return new Response(Buffer.from('png-bytes'), { status: 200 });
      }
      return new Response('no', { status: 404 });
    },
  });
  const result = await models.images.generate(
    {
      model: 'dexbuddy-image',
      input: {
        prompt: '一只猫',
        aspect_ratio: '3:4',
        input_images: [ref],
      },
      outputPath,
    },
    { idempotencyKey: 'draft-1:image' },
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.output, outputPath);
  assert.equal(result.model, 'dexbuddy-image');
  assert.equal(fs.readFileSync(outputPath, 'utf8'), 'png-bytes');
  assert.equal(JSON.stringify(result).includes('cdn.example'), false);
  assert.equal(JSON.stringify(result).includes('upload-token'), false);
  assert.deepEqual(fetched, ['https://upload.example/put', 'https://cdn.example/out.png']);
  assert.equal(
    calls.find((item) => item.path === '/v1/images/generate')?.init.headers?.['X-Plugin-Id'],
    'app-dexbuddy-xiaohongshu',
  );
});
