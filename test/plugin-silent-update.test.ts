import assert from 'node:assert/strict';
import test from 'node:test';
import { pluginZipUrl, type PluginRelease } from '../src/main/plugin-catalog.ts';
import {
  planSilentPluginUpdates,
  type PluginOriginRecord,
} from '../src/main/plugin-origins.ts';
import {
  createInstallLock,
  createPluginSilentUpdates,
  type PluginSilentUpdateHost,
  type SilentUpdateEvent,
} from '../src/main/plugin-silent-update.ts';

const sha = 'a'.repeat(64);

function release(id: string, version: string): PluginRelease {
  return {
    id,
    displayName: id,
    version,
    downloadUrl: pluginZipUrl(id, version),
    sha256: sha,
  };
}

function origin(channel: 'market' | 'file', version = '1.0.0'): PluginOriginRecord {
  return {
    channel,
    version,
    installedAt: '2026-10-13T00:00:00.000Z',
  };
}

test('市场且更高版本的插件入队，正在看的推迟', () => {
  const plan = planSilentPluginUpdates({
    catalog: [release('beta', '2.0.0'), release('alpha', '2.0.0'), release('mid', '2.0.0')],
    origins: {
      alpha: origin('market'),
      beta: origin('market'),
      mid: origin('market'),
    },
    installed: [
      { id: 'beta', version: '1.0.0', source: 'installed' },
      { id: 'alpha', version: '1.0.0', source: 'installed' },
      { id: 'mid', version: '1.0.0', source: 'installed' },
    ],
    watchingId: 'mid',
  });
  assert.deepEqual(plan.install, ['alpha', 'beta']);
  assert.deepEqual(plan.defer, ['mid']);
});

test('正在看为空时，可更新的市场插件按 id 字典序全部入队', () => {
  const plan = planSilentPluginUpdates({
    catalog: [release('zeta', '1.1.0'), release('alpha', '1.1.0')],
    origins: {
      zeta: origin('market'),
      alpha: origin('market'),
    },
    installed: [
      { id: 'zeta', version: '1.0.0', source: 'installed' },
      { id: 'alpha', version: '1.0.0', source: 'installed' },
    ],
    watchingId: null,
  });
  assert.deepEqual(plan.install, ['alpha', 'zeta']);
  assert.deepEqual(plan.defer, []);
});

test('压缩包来源和非已安装来源不入队', () => {
  const plan = planSilentPluginUpdates({
    catalog: [
      release('from-file', '2.0.0'),
      release('sample-tool', '2.0.0'),
      release('dev-tool', '2.0.0'),
      release('local-tool', '2.0.0'),
      release('market-tool', '2.0.0'),
    ],
    origins: {
      'from-file': origin('file'),
      'market-tool': origin('market'),
    },
    installed: [
      { id: 'from-file', version: '1.0.0', source: 'installed' },
      { id: 'sample-tool', version: '1.0.0', source: 'bundled' },
      { id: 'dev-tool', version: '1.0.0', source: 'dev' },
      { id: 'local-tool', version: '1.0.0', source: 'local' },
      { id: 'market-tool', version: '1.0.0', source: 'installed' },
    ],
    watchingId: null,
  });
  assert.deepEqual(plan.install, ['market-tool']);
  assert.deepEqual(plan.defer, []);
});

test('目录版本相同或更低时不入队', () => {
  const plan = planSilentPluginUpdates({
    catalog: [release('same-tool', '1.0.0'), release('older-tool', '1.0.0'), release('bad-tool', '2.0.0')],
    origins: {
      'same-tool': origin('market'),
      'older-tool': origin('market', '2.0.0'),
      'bad-tool': origin('market', '1.2'),
    },
    installed: [
      { id: 'same-tool', version: '1.0.0', source: 'installed' },
      { id: 'older-tool', version: '2.0.0', source: 'installed' },
      { id: 'bad-tool', version: '1.2', source: 'installed' },
    ],
    watchingId: '',
  });
  assert.deepEqual(plan.install, []);
  assert.deepEqual(plan.defer, []);
});

test('静默更新按字典序安装，正在看的离开后才装', async () => {
  const installedIds: string[] = [];
  const events: SilentUpdateEvent[] = [];
  const versions: Record<string, string> = { zeta: '1.0.0', alpha: '1.0.0', mid: '1.0.0' };
  const host: PluginSilentUpdateHost = {
    async fetchCatalog() {
      return { plugins: [release('zeta', '2.0.0'), release('alpha', '2.0.0'), release('mid', '2.0.0')] };
    },
    readInstalled() {
      return [
        { id: 'zeta', version: versions.zeta, source: 'installed' },
        { id: 'alpha', version: versions.alpha, source: 'installed' },
        { id: 'mid', version: versions.mid, source: 'installed' },
      ];
    },
    readOrigins() {
      return {
        zeta: origin('market'),
        alpha: origin('market'),
        mid: origin('market'),
      };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      versions[plugin.id] = plugin.version;
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send(event) {
      events.push(event);
    },
  };
  const updates = createPluginSilentUpdates(host, createInstallLock());
  updates.setWatching('mid');
  await updates.runRound();
  assert.deepEqual(installedIds, ['alpha', 'zeta']);
  updates.setWatching(null);
  await updates.whenIdle();
  assert.deepEqual(installedIds, ['alpha', 'zeta', 'mid']);
  assert.equal(events.at(-1)?.phase, 'idle');
});

test('目录读失败时不安装，已推迟的仍可在离开后补装', async () => {
  let fail = false;
  const installedIds: string[] = [];
  let version = '1.0.0';
  const events: SilentUpdateEvent[] = [];
  const updates = createPluginSilentUpdates({
    async fetchCatalog() {
      if (fail) throw new Error('offline');
      return { plugins: [release('alpha', '2.0.0')] };
    },
    readInstalled() {
      return [{ id: 'alpha', version, source: 'installed' }];
    },
    readOrigins() {
      return { alpha: origin('market') };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      version = plugin.version;
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send(event) {
      events.push(event);
    },
  }, createInstallLock());
  updates.setWatching('alpha');
  await updates.runRound();
  assert.deepEqual(installedIds, []);
  fail = true;
  await updates.runRound();
  assert.equal(events.length, 0);
  updates.setWatching(null);
  await updates.whenIdle();
  assert.deepEqual(installedIds, ['alpha']);
});

test('卸载会取消尚未开始的静默安装', async () => {
  const installedIds: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const updates = createPluginSilentUpdates({
    async fetchCatalog() {
      return { plugins: [release('alpha', '2.0.0'), release('beta', '2.0.0')] };
    },
    readInstalled() {
      return [
        { id: 'alpha', version: '1.0.0', source: 'installed' },
        { id: 'beta', version: '1.0.0', source: 'installed' },
      ];
    },
    readOrigins() {
      return { alpha: origin('market'), beta: origin('market') };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      if (plugin.id === 'alpha') {
        markStarted();
        await firstGate;
      }
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send() {},
  }, createInstallLock());
  const round = updates.runRound();
  await started;
  updates.cancel('beta');
  releaseFirst();
  await round;
  assert.deepEqual(installedIds, ['alpha']);
});

test('安装前版本已经不更高则跳过', async () => {
  const lock = createInstallLock();
  let releaseLock: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const blocking = lock.run(async () => {
    await held;
  });
  let version = '1.0.0';
  const installedIds: string[] = [];
  const updates = createPluginSilentUpdates({
    async fetchCatalog() {
      return { plugins: [release('alpha', '2.0.0')] };
    },
    readInstalled() {
      return [{ id: 'alpha', version, source: 'installed' }];
    },
    readOrigins() {
      return { alpha: origin('market') };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send() {},
  }, lock);
  const round = updates.runRound();
  await Promise.resolve();
  version = '2.0.0';
  releaseLock();
  await blocking;
  await round;
  assert.deepEqual(installedIds, []);
});

test('手动安装拿掉推迟后，离开不再静默安装', async () => {
  const installedIds: string[] = [];
  let version = '1.0.0';
  const updates = createPluginSilentUpdates({
    async fetchCatalog() {
      return { plugins: [release('alpha', '2.0.0')] };
    },
    readInstalled() {
      return [{ id: 'alpha', version, source: 'installed' }];
    },
    readOrigins() {
      return { alpha: origin('market') };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send() {},
  }, createInstallLock());
  updates.setWatching('alpha');
  await updates.runRound();
  updates.noteManualInstall('alpha');
  // 手动更新已经把本地版本抬上去；离开触发的再查不会重装。
  version = '2.0.0';
  updates.setWatching(null);
  await updates.whenIdle();
  assert.deepEqual(installedIds, []);
});

test('离开插件时再查目录，会话中途才变高的版本会装上', async () => {
  const installedIds: string[] = [];
  let remoteVersion = '1.0.0';
  let localVersion = '1.0.0';
  const updates = createPluginSilentUpdates({
    async fetchCatalog() {
      return { plugins: [release('alpha', remoteVersion)] };
    },
    readInstalled() {
      return [{ id: 'alpha', version: localVersion, source: 'installed' }];
    },
    readOrigins() {
      return { alpha: origin('market') };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      localVersion = plugin.version;
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send() {},
  }, createInstallLock());
  updates.setWatching('alpha');
  await updates.runRound();
  assert.deepEqual(installedIds, []);
  remoteVersion = '2.0.0';
  updates.setWatching(null);
  await updates.whenIdle();
  assert.deepEqual(installedIds, ['alpha']);
});

test('读目录期间离开时，本轮或紧接着的下一轮会装上', async () => {
  const installedIds: string[] = [];
  let localVersion = '1.0.0';
  let releaseCatalog: () => void = () => {};
  const catalogGate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  const updates = createPluginSilentUpdates({
    async fetchCatalog() {
      await catalogGate;
      return { plugins: [release('alpha', '2.0.0')] };
    },
    readInstalled() {
      return [{ id: 'alpha', version: localVersion, source: 'installed' }];
    },
    readOrigins() {
      return { alpha: origin('market') };
    },
    async installRelease(plugin) {
      installedIds.push(plugin.id);
      localVersion = plugin.version;
      return { ok: true, installedId: plugin.id, plugins: [] };
    },
    send() {},
  }, createInstallLock());
  updates.setWatching('alpha');
  const round = updates.runRound();
  await Promise.resolve();
  updates.setWatching(null);
  releaseCatalog();
  await round;
  await updates.whenIdle();
  assert.deepEqual(installedIds, ['alpha']);
});
