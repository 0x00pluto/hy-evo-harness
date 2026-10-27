import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayError } from '../src/main/gateway-client.ts';
import {
  createHostModels,
  createRequireEntitlement,
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

function makeHost(overrides: Partial<HostModelsDeps> = {}) {
  const calls: { path: string; init: HostModelsRequestInit }[] = [];
  const blocked: SpendBlockedPayload[] = [];
  const traces = { session: 0, shop: 0, entitlements: 0, waived: 0 };
  const deps: HostModelsDeps = {
    pluginId: overrides.pluginId ?? PLUGIN_ID,
    request: async (path, init) => {
      calls.push({ path, init });
      if (overrides.request) return overrides.request(path, init);
      if (path === '/v1/billing/quote') return chatQuote(true);
      if (path === '/v1/chat/completions') return { choices: [] };
      return {};
    },
    requireSession:
      overrides.requireSession
      ?? (async () => {
        traces.session += 1;
      }),
    shopGate:
      overrides.shopGate
      ?? (async () => {
        traces.shop += 1;
        return { ready: true, pluginIds: [] };
      }),
    activeEntitlements:
      overrides.activeEntitlements
      ?? (async () => {
        traces.entitlements += 1;
        return [];
      }),
    waivedPluginIds:
      overrides.waivedPluginIds
      ?? (async () => {
        traces.waived += 1;
        return [];
      }),
    onBlocked:
      overrides.onBlocked
      ?? ((payload) => {
        blocked.push(payload);
      }),
    readFile: overrides.readFile,
    writeFile: overrides.writeFile,
    mkdir: overrides.mkdir,
    fetchImpl: overrides.fetchImpl,
  };
  return {
    models: createHostModels(deps),
    requireEntitlement: createRequireEntitlement(deps),
    calls,
    blocked,
    traces,
  };
}

test('商城插件未买断时不转发文案，onBlocked 一次', async () => {
  const { models, calls, blocked, traces } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
    activeEntitlements: async () => [],
  });
  await assert.rejects(
    () => models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'NOT_ENTITLED' }]);
  assert.equal(traces.session, 1);
});

test('已买断则报价后转发文案', async () => {
  const { models, calls, blocked } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
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
  const { models, requireEntitlement, calls, blocked, traces } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: ['other-paid-plugin'] }),
    activeEntitlements: async () => [],
  });
  await requireEntitlement();
  await models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] });
  assert.equal(blocked.length, 0);
  assert.equal(calls[1]?.path, '/v1/chat/completions');
  assert.equal(traces.entitlements, 0);
});

test('list 与 quote 抛 UNAUTHORIZED 不通知壳', async () => {
  const { models, blocked } = makeHost({
    request: async () => {
      throw new GatewayError('UNAUTHORIZED', '未登录', 401);
    },
  });
  await assert.rejects(() => models.list(), GatewayError);
  await assert.rejects(() => models.billing.quote({ model: 'dexbuddy-chat' }), GatewayError);
  assert.equal(blocked.length, 0);
});

test('余额不够时不转发，onBlocked 一次', async () => {
  const { models, calls, blocked } = makeHost({
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

test('未登录烧模型时通知 UNAUTHORIZED，不查买断', async () => {
  const { models, calls, blocked, traces } = makeHost({
    requireSession: async () => {
      throw new GatewayError('UNAUTHORIZED', '未登录', 401);
    },
    shopGate: async () => {
      traces.shop += 1;
      return { ready: true, pluginIds: [PLUGIN_ID] };
    },
  });
  await assert.rejects(
    () => models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] }),
    (err: unknown) => err instanceof GatewayError && err.code === 'UNAUTHORIZED',
  );
  assert.equal(calls.length, 0);
  assert.equal(traces.shop, 0);
  assert.equal(traces.entitlements, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'UNAUTHORIZED' }]);
});

test('onBlocked 自己失败仍把 NOT_ENTITLED 交给插件', async () => {
  const { models, calls } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
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
  const { models, calls, blocked } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
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
  const { models, blocked } = makeHost();
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

test('未登录调用作者函数不查买断', async () => {
  const { requireEntitlement, blocked, traces } = makeHost({
    requireSession: async () => {
      throw new GatewayError('UNAUTHORIZED', '未登录', 401);
    },
    shopGate: async () => {
      traces.shop += 1;
      return { ready: true, pluginIds: [PLUGIN_ID] };
    },
  });
  await assert.rejects(
    () => requireEntitlement(),
    (err: unknown) => err instanceof GatewayError && err.code === 'UNAUTHORIZED',
  );
  assert.equal(traces.shop, 0);
  assert.equal(traces.entitlements, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'UNAUTHORIZED' }]);
});

test('已登录未买断时作者函数 NOT_ENTITLED 且不报价', async () => {
  const { requireEntitlement, calls, blocked } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
    activeEntitlements: async () => [],
  });
  await assert.rejects(
    () => requireEntitlement(),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'NOT_ENTITLED' }]);
});

test('作者函数不看积分', async () => {
  const { requireEntitlement, calls, blocked } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
    activeEntitlements: async () => [PLUGIN_ID],
    request: async () => chatQuote(false),
  });
  await requireEntitlement();
  assert.equal(calls.length, 0);
  assert.equal(blocked.length, 0);
});

test('目录失败则买断放行后再报价', async () => {
  const { models, calls, blocked, traces } = makeHost({
    shopGate: async () => ({ ready: false, pluginIds: [PLUGIN_ID] }),
    activeEntitlements: async () => [],
  });
  await models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] });
  assert.equal(blocked.length, 0);
  assert.equal(traces.entitlements, 0);
  assert.equal(calls[0]?.path, '/v1/billing/quote');
  assert.equal(calls[1]?.path, '/v1/chat/completions');
});

test('注入限免跳过买断，未登录仍先拦住', async () => {
  const loggedOut = makeHost({
    requireSession: async () => {
      throw new GatewayError('UNAUTHORIZED', '未登录', 401);
    },
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
    waivedPluginIds: async () => [PLUGIN_ID],
    activeEntitlements: async () => [],
  });
  await assert.rejects(
    () => loggedOut.requireEntitlement(),
    (err: unknown) => err instanceof GatewayError && err.code === 'UNAUTHORIZED',
  );
  assert.deepEqual(loggedOut.blocked, [{ pluginId: PLUGIN_ID, reason: 'UNAUTHORIZED' }]);

  const waived = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
    waivedPluginIds: async () => [PLUGIN_ID],
    activeEntitlements: async () => [],
  });
  await waived.requireEntitlement();
  await waived.models.chat.completions.create({ model: 'dexbuddy-chat', messages: [] });
  assert.equal(waived.blocked.length, 0);
  assert.equal(waived.traces.entitlements, 0);
  assert.equal(waived.calls[0]?.path, '/v1/billing/quote');
});

test('作者函数忽略传入的插件 id', async () => {
  const { requireEntitlement, blocked } = makeHost({
    shopGate: async () => ({ ready: true, pluginIds: [PLUGIN_ID] }),
    activeEntitlements: async () => [],
  });
  await assert.rejects(
    () => requireEntitlement('other-plugin', { pluginId: 'forged' }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.deepEqual(blocked, [{ pluginId: PLUGIN_ID, reason: 'NOT_ENTITLED' }]);
});

test('试玩 mock 已购不弹框', async () => {
  const { requireEntitlement, blocked, traces } = makeHost({
    pluginId: 'models-playground',
    shopGate: async () => ({ ready: true, pluginIds: [] }),
    activeEntitlements: async () => [],
  });
  await requireEntitlement({ pluginId: 'mock-on-sale', mockOwned: true });
  assert.equal(blocked.length, 0);
  assert.equal(traces.session, 1);
});

test('试玩 mock 未购弹 NOT_ENTITLED', async () => {
  const { requireEntitlement, blocked } = makeHost({
    pluginId: 'models-playground',
    shopGate: async () => ({ ready: true, pluginIds: [] }),
    activeEntitlements: async () => [],
  });
  await assert.rejects(
    () => requireEntitlement({ pluginId: 'mock-on-sale', mockOwned: false }),
    (err: unknown) => err instanceof GatewayError && err.code === 'NOT_ENTITLED',
  );
  assert.deepEqual(blocked, [{ pluginId: 'models-playground', reason: 'NOT_ENTITLED' }]);
});
