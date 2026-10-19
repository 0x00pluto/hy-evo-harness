import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalDirectory, instanceIdForPath } from '../src/main/instance-id.ts';
import { LocalSession } from '../src/main/local-session.ts';
import { PluginSettingsStore } from '../src/main/plugin-settings.ts';
import { ServiceRegistry } from '../src/main/registry.ts';
import type { Logger, PluginManifest } from '../src/main/types.ts';
import { instanceDataPaths, readUnpackedPaths } from '../src/main/unpacked-plugins.ts';

const silent: Logger = { info() {}, error() {} };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-local-'));
}

function writePlugin(dir: string, id: string, source: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify({
    id,
    displayName: id,
    version: '1.0.0',
    type: 'headless',
    main: 'index.js',
    configSchema: { TOKEN: { type: 'string', title: 'Token' } },
  }));
  fs.writeFileSync(path.join(dir, 'index.js'), source);
}

const installedSource = `
module.exports = {
  apply(ctx) {
    ctx.registerService('tool', {
      origin() { return 'installed'; },
      who() { return ctx.getService('hostTool') ? 'with-host' : 'no-host'; },
    });
    ctx.registerService('installedOnly', { ping() { return 'installed'; } });
  },
};
`;

const localSource = `
module.exports = {
  apply(ctx) {
    ctx.registerService('tool', {
      origin() { return 'local'; },
      who() { return ctx.getService('hostTool') ? 'with-host' : 'no-host'; },
    });
    ctx.registerService('mine', { ping() { return 'mine'; } });
  },
};
`;

test('同一清单 id 的本地实例和已安装插件服务互不可见', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installedDir = path.join(root, 'installed');
  const localDir = path.join(root, 'local');
  writePlugin(installedDir, 'foo', installedSource);
  writePlugin(localDir, 'foo', localSource);
  const registry = new ServiceRegistry(silent);
  registry.registerService('hostTool', { ping() { return 'host'; } });
  await registry.loadPluginFromDirectory(installedDir, 'installed');
  const instanceId = instanceIdForPath(canonicalDirectory(localDir));
  const mounted = await registry.mountLocal({
    record: {
      instanceId,
      manifestId: 'foo',
      sourcePath: canonicalDirectory(localDir),
      registeredPath: canonicalDirectory(localDir),
      from: 'page',
      mount: 'source',
    },
    pluginDir: localDir,
    layout: 'repo',
  });
  assert.equal(mounted, null);
  assert.equal(registry.getPluginList().filter((item) => item.manifestId === 'foo').length, 2);

  const installed = await registry.callService('tool', 'origin', []) as string;
  const local = await registry.callService('tool', 'origin', [], instanceId) as string;
  assert.equal(installed, 'installed');
  assert.equal(local, 'local');
  assert.equal(await registry.callService('tool', 'who', [], instanceId), 'with-host');
  await assert.rejects(() => registry.callService('mine', 'ping', []), /不存在/);
  assert.equal(await registry.callService('mine', 'ping', [], instanceId), 'mine');
  await assert.rejects(() => registry.callService('installedOnly', 'ping', [], instanceId), /不存在/);
  assert.equal(await registry.callService('installedOnly', 'ping', []), 'installed');
  assert.equal(registry.getService('tool') && (registry.getService('tool') as { origin?: () => string }).origin?.(), 'installed');
});

test('预览失败不执行 apply，结束预览回到源码并保留实例设置', async (t) => {
  const root = tempDir();
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'plugin');
  const countFile = path.join(root, 'applies.txt');
  fs.writeFileSync(countFile, '');
  writePlugin(source, 'foo', `const fs = require('fs'); module.exports = { apply() { fs.appendFileSync(${JSON.stringify(countFile)}, 'x'); } };`);
  fs.writeFileSync(path.join(source, 'dex-buddy-plugin.pack'), '!\n');

  const registry = new ServiceRegistry(silent);
  const settings = new PluginSettingsStore(path.join(userData, 'plugin-settings.json'), silent);
  registry.setSettings(settings);
  registry.setRuntimeHost({ userData });
  const sourcePath = canonicalDirectory(source);
  const instanceId = instanceIdForPath(sourcePath);
  const record = {
    instanceId,
    manifestId: 'foo',
    sourcePath,
    registeredPath: sourcePath,
    from: 'page' as const,
    mount: 'source' as const,
  };
  assert.equal(await registry.mountLocal({ record, pluginDir: source, layout: 'repo' }), null);
  assert.equal(fs.readFileSync(countFile, 'utf8'), 'x');
  const manifest: PluginManifest = {
    id: 'foo',
    displayName: 'foo',
    version: '1.0.0',
    type: 'headless',
    configSchema: { TOKEN: { type: 'string', title: 'Token' } },
  };
  assert.equal(settings.save(manifest, { values: { TOKEN: 'installed-secret' } }).ok, true);
  assert.equal(settings.save(manifest, { values: { TOKEN: 'local-secret' } }, instanceId).ok, true);

  const session = new LocalSession({
    registry,
    userData,
    unpackedFile: path.join(userData, 'unpacked-plugins.json'),
    logger: silent,
  });
  const preview = await session.startPreview(instanceId);
  assert.equal(preview.ok, false);
  assert.match(preview.message ?? '', /无效/);
  assert.equal(fs.readFileSync(countFile, 'utf8'), 'x');
  assert.equal(registry.getPlugin(instanceId), undefined);
  const failed = registry.getPluginList().find((item) => item.id === instanceId);
  assert.ok(failed?.previewError);
  assert.equal(failed?.runtimeError, undefined);
  assert.equal(settings.getPluginConfig(manifest).TOKEN, 'installed-secret');
  assert.equal(settings.getPluginConfig(manifest, instanceId).TOKEN, 'local-secret');

  fs.writeFileSync(path.join(source, 'dex-buddy-plugin.pack'), 'index.js\nplugin.manifest.json\n');
  const again = await session.startPreview(instanceId);
  assert.equal(again.ok, true);
  assert.equal(fs.readFileSync(countFile, 'utf8'), 'xx');
  const running = registry.getPlugin(instanceId);
  assert.ok(running);
  assert.equal(running?.mount, 'preview');
  assert.ok(running?.dirs?.data.includes(instanceId));
  assert.equal(running?.dirs?.data.includes(`${path.sep}foo${path.sep}`), false);
  assert.equal(fs.existsSync(instanceDataPaths(userData, 'foo').dataDir), false);

  const ended = await session.endPreview(instanceId);
  assert.equal(ended.find((item) => item.id === instanceId)?.mount, 'source');
  assert.equal(fs.existsSync(instanceDataPaths(userData, instanceId).previewDir), false);
  assert.equal(registry.getPlugin(instanceId)?.absPath, sourcePath);
  assert.equal(settings.getPluginConfig(manifest, instanceId).TOKEN, 'local-secret');
  assert.equal(settings.getPluginConfig(manifest).TOKEN, 'installed-secret');
  assert.equal(fs.existsSync(path.join(source, 'index.js')), true);
});

test('非法目录不写入登记，移除不删源码和清单 id 设置', async (t) => {
  const root = tempDir();
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unpackedFile = path.join(userData, 'unpacked-plugins.json');
  const registry = new ServiceRegistry(silent);
  const settings = new PluginSettingsStore(path.join(userData, 'plugin-settings.json'), silent);
  registry.setSettings(settings);
  registry.setRuntimeHost({ userData });
  const session = new LocalSession({
    registry,
    userData,
    unpackedFile,
    logger: silent,
  });

  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  const rejected = await session.addDirectory(empty);
  assert.equal(rejected.ok, false);
  assert.deepEqual(readUnpackedPaths(unpackedFile), []);

  const source = path.join(root, 'plugin');
  writePlugin(source, 'foo', 'module.exports = { apply() {} };');
  const added = await session.addDirectory(source);
  assert.equal(added.ok, true);
  const instanceId = added.focusedId ?? '';
  assert.match(instanceId, /^dev-[0-9a-f]{32}$/);
  const again = await session.addDirectory(source);
  assert.equal(again.already, true);
  assert.equal(again.focusedId, instanceId);
  assert.equal(readUnpackedPaths(unpackedFile).length, 1);

  const manifest: PluginManifest = {
    id: 'foo',
    displayName: 'foo',
    version: '1.0.0',
    type: 'headless',
    configSchema: { TOKEN: { type: 'string', title: 'Token' } },
  };
  settings.save(manifest, { values: { TOKEN: 'keep' } });
  settings.save(manifest, { values: { TOKEN: 'local' } }, instanceId);
  fs.mkdirSync(instanceDataPaths(userData, 'foo').dataDir, { recursive: true });
  fs.writeFileSync(path.join(instanceDataPaths(userData, 'foo').dataDir, 'keep.txt'), 'yes');

  await session.remove(instanceId);
  assert.equal(fs.existsSync(path.join(source, 'index.js')), true);
  assert.equal(registry.getPlugin(instanceId), undefined);
  assert.equal(settings.getPluginConfig(manifest).TOKEN, 'keep');
  assert.equal(fs.readFileSync(path.join(instanceDataPaths(userData, 'foo').dataDir, 'keep.txt'), 'utf8'), 'yes');
  assert.equal(fs.existsSync(instanceDataPaths(userData, instanceId).dataDir), false);
  assert.deepEqual(readUnpackedPaths(unpackedFile), []);
});

test('重新加载清掉 require 缓存，并从源码目录重读清单', async (t) => {
  const root = tempDir();
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'plugin');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'plugin.manifest.json'), JSON.stringify({
    id: 'reload-demo',
    displayName: 'reload-demo',
    version: '1.0.0',
    type: 'headless',
    main: 'index.js',
  }));
  fs.writeFileSync(path.join(source, 'message.js'), 'module.exports = { text: "old" };\n');
  fs.writeFileSync(
    path.join(source, 'index.js'),
    'const { text } = require("./message"); module.exports = { apply(ctx) { ctx.registerService("reloadDemo", { text() { return text; } }); } };\n',
  );

  const registry = new ServiceRegistry(silent);
  registry.setRuntimeHost({ userData });
  const session = new LocalSession({
    registry,
    userData,
    unpackedFile: path.join(userData, 'unpacked-plugins.json'),
    logger: silent,
  });
  const added = await session.addDirectory(source);
  assert.equal(added.ok, true);
  const instanceId = added.focusedId ?? '';
  assert.equal(await registry.callService('reloadDemo', 'text', [], instanceId), 'old');
  assert.equal(registry.getPluginList().find((item) => item.id === instanceId)?.version, '1.0.0');

  fs.writeFileSync(path.join(source, 'message.js'), 'module.exports = { text: "new" };\n');
  fs.writeFileSync(path.join(source, 'plugin.manifest.json'), JSON.stringify({
    id: 'reload-demo',
    displayName: 'reload-demo',
    version: '2.0.0',
    type: 'headless',
    main: 'index.js',
  }));
  const plugins = await session.reload(instanceId);
  assert.equal(plugins.find((item) => item.id === instanceId)?.version, '2.0.0');
  assert.equal(await registry.callService('reloadDemo', 'text', [], instanceId), 'new');
  assert.equal(registry.getPlugin(instanceId)?.mount, 'source');
});

test('预览中重新加载回到源码目录', async (t) => {
  const root = tempDir();
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'plugin');
  writePlugin(source, 'preview-reload', 'module.exports = { apply(ctx) { ctx.registerService("previewReload", { ok() { return true; } }); } };');
  fs.writeFileSync(path.join(source, 'dex-buddy-plugin.pack'), 'index.js\nplugin.manifest.json\n');

  const registry = new ServiceRegistry(silent);
  registry.setRuntimeHost({ userData });
  const session = new LocalSession({
    registry,
    userData,
    unpackedFile: path.join(userData, 'unpacked-plugins.json'),
    logger: silent,
  });
  const added = await session.addDirectory(source);
  assert.equal(added.ok, true);
  const instanceId = added.focusedId ?? '';
  const preview = await session.startPreview(instanceId);
  assert.equal(preview.ok, true);
  assert.equal(registry.getPlugin(instanceId)?.mount, 'preview');

  const plugins = await session.reload(instanceId);
  assert.equal(plugins.find((item) => item.id === instanceId)?.mount, 'source');
  assert.equal(registry.getPlugin(instanceId)?.absPath, canonicalDirectory(source));
  assert.equal(fs.existsSync(instanceDataPaths(userData, instanceId).previewDir), false);
  assert.equal(await registry.callService('previewReload', 'ok', [], instanceId), true);
});

test('清单不合法或实例 id 撞车时不写登记', async (t) => {
  const root = tempDir();
  const userData = path.join(root, 'user');
  fs.mkdirSync(userData);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unpackedFile = path.join(userData, 'unpacked-plugins.json');
  const registry = new ServiceRegistry(silent);
  registry.setRuntimeHost({ userData });
  const session = new LocalSession({
    registry,
    userData,
    unpackedFile,
    logger: silent,
  });

  const bad = path.join(root, 'bad');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'plugin.manifest.json'), JSON.stringify({
    id: 'Not Valid',
    displayName: '坏',
    version: '1.0.0',
    type: 'headless',
  }));
  const invalid = await session.addDirectory(bad);
  assert.equal(invalid.ok, false);
  assert.match(invalid.message ?? '', /manifest\.id/);
  assert.deepEqual(readUnpackedPaths(unpackedFile), []);

  const source = path.join(root, 'plugin');
  writePlugin(source, 'foo', 'module.exports = { apply() {} };');
  const instanceId = instanceIdForPath(canonicalDirectory(source));
  await registry.loadPlugin({
    manifest: {
      id: instanceId,
      displayName: '占位',
      version: '1.0.0',
      type: 'headless',
    },
    absPath: root,
    source: 'bundled',
    apply() {},
  });
  const collided = await session.addDirectory(source);
  assert.equal(collided.ok, false);
  assert.match(collided.message ?? '', /相同/);
  assert.deepEqual(readUnpackedPaths(unpackedFile), []);
  assert.equal(registry.getPlugin(instanceId)?.source, 'bundled');
});
