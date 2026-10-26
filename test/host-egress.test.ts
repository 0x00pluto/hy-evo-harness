import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayError } from '../src/main/gateway-client.ts';
import {
  createHostModels,
  type HostModelsDeps,
  type HostModelsRequestInit,
} from '../src/main/host-egress.ts';
import type { SpendBlockedPayload } from '../src/shared/dex-bridge.ts';

const PLUGIN_ID = 'app-dexbuddy-xiaohongshu';

function chatQuote(enough: boolean) {
  return {
    kind: 'chat',
    estimate: '0.0100',
    enough,
    balance: enough ? '10.0000' : '0.0000',
    model: 'dexbuddy-chat',
  };
}

function imageQuote(enough: boolean) {
  return {
    kind: 'image',
    estimate: '1.0000',
    enough,
    balance: enough ? '10.0000' : '0.0000',
    model: 'dexbuddy-image',
  };
}

function makeModels(overrides: Partial<HostModelsDeps> = {}) {
  const calls: { path: string; init: HostModelsRequestInit }[] = [];
  const blocked: SpendBlockedPayload[] = [];
  const models = createHostModels({
    pluginId: PLUGIN_ID,
    request: async (path, init) => {
      calls.push({ path, init });
      if (overrides.request) return overrides.request(path, init);
      if (path === '/v1/billing/quote') return chatQuote(true);
      if (path === '/v1/chat/completions') return { choices: [] };
      return {};
    },
    shopPluginIds: overrides.shopPluginIds ?? (async () => []),
    activeEntitlements: overrides.activeEntitlements ?? (async () => []),
    onBlocked: overrides.onBlocked ?? ((payload) => {
      blocked.push(payload);
    }),
    readFile: overrides.readFile,
    writeFile: overrides.writeFile,
    mkdir: overrides.mkdir,
    fetchImpl: overrides.fetchImpl,
  });
  return { models, calls, blocked };
}

test('商城插件未买断时不转发文案，onBlocked 一次', async () => {
  const { models, calls, blocked } = makeModels({
    shopPluginIds: async () => [PLUGIN_ID],
    activeEntitlements: async () => [],
  });
  await assert.rejects(
    () => models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'NOT_ENTITLED' }]);
});

test('已买断则报价后转发文案', async () => {
  const { models, calls, blocked } = makeModels({
    shopPluginIds: async () => [PLUGIN_ID],
    activeEntitlements: async () => [PLUGIN_ID],
  });
  const result = await models.chat.completions.create({
    model: 'dexbuddy-chat',
    messages: [{ role: 'user', content: 'hi' }],
    pluginId: 'forged',
  });
  assert.deepEqual(result, { choices: [] });
  assert.equal(blocked.length, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.path, '/v1/billing/quote');
  assert.equal(calls[1]?.path, '/v1/chat/completions');
  assert.equal(calls[1]?.init.headers?.['X-Plugin-Id'], PLUGIN_ID);
  const body = calls[1]?.init.body as Record<string, unknown>;
  assert.equal(body.pluginId, undefined);
});

test('不在商城的清单 id 只验余额，不弹买断', async () => {
  const { models, calls, blocked } = makeModels({
    shopPluginIds: async () => ['other-paid-plugin'],
    activeEntitlements: async () => [],
  });
  await models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] });
  assert.equal(blocked.length, 0);
  assert.equal(calls[1]?.path, '/v1/chat/completions');
});

test('list 与 quote 抛 UNAUTHORIZED 不通知壳', async () => {
  const { models, blocked } = makeModels({
    request: async () => {
      throw new GatewayError('UNAUTHORIZED', '未登录', 401);
    },
  });
  await assert.rejects(() => models.list(), GatewayError);
  await assert.rejects(() => models.billing.quote({ model: 'dexbuddy-chat' }), GatewayError);
  assert.equal(blocked.length, 0);
});

test('余额不够时不转发，onBlocked 一次', async () => {
  const { models, calls, blocked } = makeModels({
    request: async (path) => {
      if (path === '/v1/billing/quote') return chatQuote(false);
      return { choices: [] };
    },
  });
  await assert.rejects(
    () => models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] }),
    (err: unknown) => err instanceof GatewayError && err.code === 'INSUFFICIENT_CREDITS',
  );
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'INSUFFICIENT_CREDITS' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/v1/billing/quote');
});

test('未登录烧模型时通知 UNAUTHORIZED', async () => {
  const { models, calls, blocked } = makeModels({
    shopPluginIds: async () => {
      throw new GatewayError('UNAUTHORIZED', '未登录', 401);
    },
  });
  await assert.rejects(
    () => models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] }),
    (err: unknown) => err instanceof GatewayError && err.code === 'UNAUTHORIZED',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'UNAUTHORIZED' }]);
});

test('onBlocked 自己失败仍把 NOT_ENTITLED 交给插件', async () => {
  const { models, calls } = makeModels({
    shopPluginIds: async () => [PLUGIN_ID],
    activeEntitlements: async () => [],
    onBlocked: () => {
      throw new Error('shell down');
    },
  });
  await assert.rejects(
    () => models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.equal(calls.length, 0);
});

test('生图未买断同样拦住且通知一次', async () => {
  const { models, calls, blocked } = makeModels({
    shopPluginIds: async () => [PLUGIN_ID],
    activeEntitlements: async () => [],
    request: async (path, init) => {
      calls.push({ path, init });
      if (path === '/v1/billing/quote') return imageQuote(true);
      return {};
    },
  });
  await assert.rejects(
    () =>
      models.images.generate({
        model: 'dexbuddy-image',
        input: { prompt: 'a cat' },
        outputPath: '/tmp/out.png',
      }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'NOT_ENTITLED' }]);
});

test('参数错误不通知壳', async () => {
  const { models, blocked } = makeModels();
  await assert.rejects(
    () =>
      models.images.generate({
        model: '',
        input: { prompt: 'a cat' },
        outputPath: '/tmp/out.png',
      }),
    (err: unknown) => err instanceof GatewayError && err.code === 'INVALID_BODY',
  );
  assert.equal(blocked.length, 0);
});
