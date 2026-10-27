import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uninstallInstalledPlugin } from '../src/main/install.ts';
import {
  listOrphans,
  readOrigins,
  writeOrigin,
  type PluginOriginRecord,
} from '../src/main/plugin-origins.ts';
import { pluginDataDir, pluginRuntimeDir } from '../src/main/plugin-runtime.ts';
import { PluginSettingsStore } from '../src/main/plugin-settings.ts';
import { ServiceRegistry } from '../src/main/registry.ts';
import type { Logger, PluginManifest } from '../src/main/types.ts';

const silent: Logger = { info() {}, error() {} };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-orphan-'));
}

function writePlugin(dir: string, manifest: PluginManifest, source: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), source);
}

function headless(id: string, displayName = id): PluginManifest {
  return { id, displayName, version: '1.0.0', type: 'headless', main: 'index.js' };
}

function marketOrigin(version = '1.0.0'): PluginOriginRecord {
  return { channel: 'market', version, installedAt: '2026-01-01T00:00:00.000Z' };
}

function fileOrigin(): PluginOriginRecord {
  return { channel: 'file', version: '1.0.0', installedAt: '2026-01-01T00:00:00.000Z' };
}

test('listOrphans：市场旧 id 且不在目录是孤儿，其余不是', () => {
  const origins = {
    'old-id': marketOrigin(),
    'new-id': marketOrigin(),
    'zipped': fileOrigin(),
  };
  const dirNames = ['old-id', 'new-id', 'zipped', '.old-id.bak', '__MACOSX', 'stray'];
  const catalog = { ok: true as const, plugins: [{ id: 'new-id' }] };
  assert.deepEqual(listOrphans(dirNames, origins, catalog), ['old-id']);
  assert.deepEqual(listOrphans(dirNames, origins, null), []);
  assert.deepEqual(listOrphans(dirNames, origins, { ok: false }), []);
  assert.deepEqual(
    listOrphans(['still-listed'], { 'still-listed': marketOrigin() }, { ok: true, plugins: [{ id: 'still-listed' }] }),
    [],
  );
});

test('已加载的市场旧 id 标成孤儿，新 id 不是；删旧后新目录仍在', async (t) => {
  const userData = tempDir();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const installed = path.join(userData, 'installed_plugins');
  const oldId = 'xiaohongshu';
  const newId = 'app-dexbuddy-xiaohongshu';
  writePlugin(
    path.join(installed, oldId),
    headless(oldId, '小红书旧版'),
    'module.exports = { apply() {} };',
  );
  writePlugin(
    path.join(installed, newId),
    headless(newId, '小红书'),
    'module.exports = { apply() {} };',
  );
  fs.mkdirSync(path.join(pluginRuntimeDir(userData, oldId), 'env'), { recursive: true });
  fs.mkdirSync(path.join(pluginRuntimeDir(userData, newId), 'env'), { recursive: true });
  fs.mkdirSync(path.join(pluginDataDir(userData, oldId), 'output'), { recursive: true });
  fs.writeFileSync(path.join(pluginDataDir(userData, oldId), 'output', 'keep.txt'), 'stay');
  const settingsFile = path.join(userData, 'plugin-settings.json');
  fs.writeFileSync(settingsFile, `${JSON.stringify({ [oldId]: { TOKEN: 'old' }, [newId]: { TOKEN: 'new' } }, null, 2)}\n`);
  const originsFile = path.join(userData, 'plugin-origins.json');
  writeOrigin(originsFile, oldId, marketOrigin());
  writeOrigin(originsFile, newId, marketOrigin());

  const registry = new ServiceRegistry(silent, new PluginSettingsStore(settingsFile, silent));
  registry.setRuntimeHost({ userData });
  registry.setInstalledPluginsDir(installed);
  registry.setOriginsLookup(() => readOrigins(originsFile));
  registry.setOriginLookup((id) => readOrigins(originsFile)[id]?.channel);
  await registry.scanAndLoadPlugins(installed, 'installed');
  assert.equal(fs.existsSync(path.join(installed, oldId)), true);
  assert.equal(fs.existsSync(path.join(installed, newId)), true);

  registry.setCatalogSnapshot({ ok: true, plugins: [{ id: newId }] });
  const listed = registry.getPluginList();
  const oldRow = listed.find((item) => item.id === oldId);
  const newRow = listed.find((item) => item.id === newId);
  assert.equal(oldRow?.orphan, true);
  assert.equal(oldRow?.source, 'installed');
  assert.equal(newRow?.orphan, undefined);
  assert.equal(listed.filter((item) => item.id === oldId).length, 1);

  registry.setCatalogSnapshot({ ok: false });
  assert.equal(registry.getPluginList().some((item) => item.orphan), false);
  assert.equal(fs.existsSync(path.join(installed, oldId)), true);
  assert.equal(fs.existsSync(path.join(installed, newId)), true);

  registry.setCatalogSnapshot({ ok: true, plugins: [{ id: newId }] });
  await uninstallInstalledPlugin({
    registry,
    id: oldId,
    userPluginsDir: installed,
    originsFile,
  });
  assert.equal(fs.existsSync(path.join(installed, oldId)), false);
  assert.equal(fs.existsSync(path.join(installed, newId)), true);
  assert.equal(fs.existsSync(pluginRuntimeDir(userData, oldId)), false);
  assert.equal(fs.existsSync(pluginRuntimeDir(userData, newId)), true);
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
  assert.equal(settings[oldId], undefined);
  assert.deepEqual(settings[newId], { TOKEN: 'new' });
  const origins = readOrigins(originsFile);
  assert.equal(origins[oldId], undefined);
  assert.equal(origins[newId]?.channel, 'market');
  assert.equal(fs.readFileSync(path.join(pluginDataDir(userData, oldId), 'output', 'keep.txt'), 'utf8'), 'stay');
  assert.equal(registry.getPluginList().some((item) => item.id === oldId), false);
  assert.equal(registry.getPluginList().find((item) => item.id === newId)?.orphan, undefined);
});

test('加载失败的孤儿补一行，且只有这一条', async (t) => {
  const userData = tempDir();
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const installed = path.join(userData, 'installed_plugins');
  const brokenId = 'broken-market';
  const liveId = 'live-market';
  fs.mkdirSync(path.join(installed, brokenId), { recursive: true });
  fs.writeFileSync(path.join(installed, brokenId, 'plugin.manifest.json'), '{not json');
  writePlugin(
    path.join(installed, liveId),
    headless(liveId, '在架'),
    'module.exports = { apply() {} };',
  );
  const originsFile = path.join(userData, 'plugin-origins.json');
  writeOrigin(originsFile, brokenId, marketOrigin());
  writeOrigin(originsFile, liveId, marketOrigin());

  const registry = new ServiceRegistry(silent);
  registry.setRuntimeHost({ userData });
  registry.setInstalledPluginsDir(installed);
  registry.setOriginsLookup(() => readOrigins(originsFile));
  await registry.scanAndLoadPlugins(installed, 'installed');
  registry.setCatalogSnapshot({ ok: true, plugins: [{ id: liveId }] });

  const brokenRows = registry.getPluginList().filter((item) => item.id === brokenId);
  assert.equal(brokenRows.length, 1);
  assert.equal(brokenRows[0]?.orphan, true);
  assert.equal(brokenRows[0]?.source, 'installed');
  assert.equal(brokenRows[0]?.displayName, brokenId);
  assert.match(brokenRows[0]?.runtimeError ?? '', /未能加载/);
  assert.equal(brokenRows[0]?.rootPath, path.resolve(installed, brokenId));
  assert.equal(registry.listSettingsViews().some((item) => item.id === brokenId), false);

  const zipId = 'zip-only';
  writePlugin(path.join(installed, zipId), headless(zipId, '压缩包'), 'module.exports = { apply() {} };');
  await registry.scanAndLoadPlugins(path.join(installed, zipId), 'installed');
  registry.setCatalogSnapshot({ ok: true, plugins: [{ id: liveId }] });
  assert.equal(registry.getPluginList().find((item) => item.id === zipId)?.orphan, undefined);
});
