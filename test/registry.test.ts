import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import { readExtraPluginPaths, readForceUpdateIcon } from '../src/main/dev-config.ts';
import { assertZipEntriesSafe, installPluginZip, uninstallInstalledPlugin } from '../src/main/install.ts';
import { resolvePluginAsset, resolvePluginFile } from '../src/main/protocol.ts';
import { DuplicatePluginError, ServiceRegistry } from '../src/main/registry.ts';
import type { AppPlugin, Logger, PluginManifest } from '../src/main/types.ts';

const execFileAsync = promisify(execFile);
const silent: Logger = { info() {}, error() {} };
const repoPlugins = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugins');

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-'));
}

function writePlugin(dir: string, manifest: PluginManifest, source: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), source);
}

function headless(id: string, displayName = id): PluginManifest {
  return { id, displayName, version: '1.0.0', type: 'headless', main: 'index.js' };
}

function pluginStub(manifest: PluginManifest, apply: AppPlugin['apply']): AppPlugin {
  return {
    manifest,
    absPath: os.tmpdir(),
    source: 'bundled',
    apply,
  };
}

function makeStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, entry.data]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

test('扫描插件目录，跳过无 manifest 的项', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePlugin(
    path.join(root, 'good'),
    headless('good', '好插件'),
    'module.exports = { apply(ctx) { ctx.registerService("goodService", { ok: true }); } };',
  );
  fs.mkdirSync(path.join(root, 'empty-dir'));
  fs.writeFileSync(path.join(root, 'note.txt'), 'skip');
  const registry = new ServiceRegistry(silent);
  await registry.scanAndLoadPlugins(root, 'bundled');
  assert.deepEqual(
    registry.getPluginList().map((item) => item.id),
    ['good'],
  );
  assert.deepEqual(registry.getService('goodService'), { ok: true });
});

test('路径本身是插件根时直接加载', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePlugin(root, headless('solo', '独立插件'), 'module.exports = { apply() {} };');
  const registry = new ServiceRegistry(silent);
  await registry.scanAndLoadPlugins(root, 'dev');
  assert.equal(registry.getPluginList()[0]?.source, 'dev');
  assert.equal(registry.getPluginList()[0]?.rootPath, path.resolve(root));
  assert.equal(registry.getPlugin('solo')?.manifest.displayName, '独立插件');
});

test('不存在的目录不会报错', async () => {
  const registry = new ServiceRegistry(silent);
  await registry.scanAndLoadPlugins(path.join(os.tmpdir(), 'dex-buddy-missing-plugins'), 'bundled');
  assert.deepEqual(registry.getPluginList(), []);
});

test('重复 id 保持先加载的插件', async (t) => {
  const rootA = tempDir();
  const rootB = tempDir();
  t.after(() => {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });
  writePlugin(path.join(rootA, 'one'), headless('same', '第一份'), 'module.exports = { apply(ctx) { ctx.registerService("sameService", { from: 1 }); } };');
  writePlugin(path.join(rootB, 'one'), headless('same', '第二份'), 'module.exports = { apply(ctx) { ctx.registerService("sameService", { from: 2 }); } };');
  const registry = new ServiceRegistry(silent);
  await registry.scanAndLoadPlugins(rootA, 'bundled');
  await registry.scanAndLoadPlugins(rootB, 'installed');
  assert.equal(registry.getPluginList().length, 1);
  assert.equal(registry.getPlugin('same')?.source, 'bundled');
  assert.deepEqual(registry.getService('sameService'), { from: 1 });
  await assert.rejects(
    () => registry.loadPlugin(pluginStub(headless('same'), () => {})),
    DuplicatePluginError,
  );
});

test('卸载后服务和监听器消失', async () => {
  const registry = new ServiceRegistry(silent);
  let hits = 0;
  await registry.loadPlugin(
    pluginStub(headless('crawler', '爬虫'), (ctx) => {
      ctx.registerService('crawlerService', { ping: () => 'pong' });
      ctx.on('trigger-all-spiders', () => {
        hits += 1;
      });
    }),
  );
  registry.emit('trigger-all-spiders');
  const service = registry.getService<{ ping: () => string }>('crawlerService');
  assert.equal(service?.ping(), 'pong');
  assert.equal(hits, 1);
  await registry.unloadPlugin('crawler');
  registry.emit('trigger-all-spiders');
  assert.equal(hits, 1);
  assert.equal(registry.getService('crawlerService'), undefined);
  assert.equal(registry.getPlugin('crawler'), undefined);
});

test('apply 失败会回滚服务和监听器，且不挡住后续插件', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const errors: string[] = [];
  const registry = new ServiceRegistry({
    info() {},
    error(msg) {
      errors.push(msg);
    },
  });
  let hits = 0;
  await assert.rejects(
    () =>
      registry.loadPlugin(
        pluginStub(headless('bad'), (ctx) => {
          ctx.registerService('badService', { n: 1 });
          ctx.on('tick', () => {
            hits += 1;
          });
          throw new Error('boom');
        }),
      ),
    /boom/,
  );
  registry.emit('tick');
  assert.equal(hits, 0);
  assert.equal(registry.getService('badService'), undefined);

  writePlugin(
    path.join(root, 'bad'),
    headless('bad-disk'),
    'module.exports = { apply(ctx) { ctx.registerService("diskBad", {}); throw new Error("disk-boom"); } };',
  );
  writePlugin(
    path.join(root, 'good'),
    headless('good'),
    'module.exports = { apply(ctx) { ctx.registerService("goodService", { ok: true }); } };',
  );
  const invalidDir = path.join(root, 'invalid');
  fs.mkdirSync(invalidDir);
  fs.writeFileSync(path.join(invalidDir, 'plugin.manifest.json'), '{"id":"Not Valid"}');
  await registry.scanAndLoadPlugins(root, 'bundled');
  assert.deepEqual(registry.getService('goodService'), { ok: true });
  assert.equal(registry.getService('diskBad'), undefined);
  assert.equal(registry.getPlugin('bad-disk'), undefined);
  assert.ok(errors.some((msg) => msg.includes('disk-boom')));
  assert.ok(errors.some((msg) => msg.includes('manifest.id')));
});

test('拒绝重复注册同名服务', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const errors: string[] = [];
  const registry = new ServiceRegistry({
    info() {},
    error(msg) {
      errors.push(msg);
    },
  });
  writePlugin(path.join(root, 'a'), headless('plugin-a'), 'module.exports = { apply(ctx) { ctx.registerService("shared", { owner: "a" }); } };');
  writePlugin(path.join(root, 'b'), headless('plugin-b'), 'module.exports = { apply(ctx) { ctx.registerService("shared", { owner: "b" }); } };');
  await registry.scanAndLoadPlugins(path.join(root, 'a'), 'bundled');
  await registry.scanAndLoadPlugins(path.join(root, 'b'), 'bundled');
  assert.equal(registry.getPluginList().length, 2);
  assert.deepEqual(registry.getService('shared'), { owner: 'a' });
  assert.ok(errors.some((msg) => msg.includes('已存在')));
  await assert.rejects(() => registry.callService('shared', 'toString', []), /不存在/);
});

test('插件文件路径拒绝逃逸', (t) => {
  const root = tempDir();
  const outside = tempDir();
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
  fs.mkdirSync(path.join(root, 'ui'));
  fs.writeFileSync(path.join(root, 'ui', 'ok.txt'), 'yes');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'ui', 'leak.txt'));

  assert.equal(resolvePluginFile(root, '../secret.txt'), null);
  assert.equal(resolvePluginFile(root, '/etc/passwd'), null);
  assert.equal(resolvePluginFile(root, 'ui/../../secret.txt'), null);
  assert.equal(resolvePluginFile(root, ''), null);
  assert.equal(resolvePluginFile(root, 'ui/\0ok.txt'), null);
  assert.equal(resolvePluginAsset(root, 'ui/leak.txt'), null);
  assert.equal(resolvePluginAsset(root, 'ui'), null);
  assert.ok(resolvePluginAsset(root, 'ui/ok.txt')?.endsWith(`${path.sep}ok.txt`));
});

test('示例插件可以扫描并调用', async () => {
  const registry = new ServiceRegistry(silent);
  await registry.scanAndLoadPlugins(repoPlugins, 'bundled');
  const list = registry.getPluginList();
  assert.deepEqual(
    list.map((item) => item.id).sort(),
    ['ai-comic-master', 'quanmedia-crawl'],
  );
  const comic = list.find((item) => item.id === 'ai-comic-master');
  assert.equal(comic?.uiUrl, 'app-plugin://ai-comic-master/ui/index.html');
  assert.equal(list.find((item) => item.id === 'quanmedia-crawl')?.uiUrl, null);
  assert.deepEqual(await registry.callService('aiComicService', 'renderVideo', [{ prompt: '古风修仙场景' }]), {
    success: true,
    videoPath: '/outputs/demo.mp4',
    prompt: '古风修仙场景',
  });
  assert.deepEqual(await registry.callService('crawlerService', 'fetchAccountData', ['douyin', 'abc']), {
    platform: 'douyin',
    accountId: 'abc',
    followers: 10000,
  });
});

test('开发配置只返回有效的额外路径', (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const errors: string[] = [];
  const logger: Logger = {
    info() {},
    error(msg) {
      errors.push(msg);
    },
  };
  assert.deepEqual(readExtraPluginPaths(path.join(root, 'missing.json'), logger), []);
  const invalid = path.join(root, 'bad.json');
  fs.writeFileSync(invalid, '{');
  assert.deepEqual(readExtraPluginPaths(invalid, logger), []);
  const config = path.join(root, 'config.dev.json');
  fs.writeFileSync(config, JSON.stringify({ extraPluginPaths: ['/tmp/plugin-a', '', 3] }));
  assert.deepEqual(readExtraPluginPaths(config, logger), ['/tmp/plugin-a']);
  assert.equal(readForceUpdateIcon(config, logger), false);
  fs.writeFileSync(config, JSON.stringify({ extraPluginPaths: [], forceUpdateIcon: true }));
  assert.equal(readForceUpdateIcon(config, logger), true);
  fs.writeFileSync(config, JSON.stringify({ extraPluginPaths: [], forceUpdateIcon: 'yes' }));
  assert.equal(readForceUpdateIcon(config, logger), false);
  assert.equal(readForceUpdateIcon(path.join(root, 'missing.json'), logger), false);
  assert.ok(errors.length >= 2);
});

test('zip 安装后可调用，再次安装会替换，卸载后服务消失', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const pluginDir = path.join(work, 'sample-tool');
  writePlugin(
    pluginDir,
    headless('sample-tool', '示例工具'),
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "v1"; } }); } };',
  );
  const zipV1 = path.join(work, 'sample-tool-v1.zip');
  await execFileAsync('zip', ['-r', zipV1, 'sample-tool'], { cwd: work });

  const installed = path.join(work, 'installed');
  const registry = new ServiceRegistry(silent);
  const list = await installPluginZip({ registry, zipFilePath: zipV1, userPluginsDir: installed });
  assert.equal(list.plugins.some((item) => item.id === 'sample-tool' && item.source === 'installed'), true);
  assert.equal(await registry.callService('sampleTool', 'ping', []), 'v1');

  fs.writeFileSync(
    path.join(pluginDir, 'index.js'),
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "v2"; } }); } };',
  );
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.manifest.json'),
    JSON.stringify({ ...headless('sample-tool', '示例工具'), version: '1.2.0' }),
  );
  const zipV2 = path.join(work, 'sample-tool-v2.zip');
  await execFileAsync('zip', ['-r', zipV2, 'sample-tool'], { cwd: work });
  await installPluginZip({ registry, zipFilePath: zipV2, userPluginsDir: installed });
  assert.equal(registry.getPlugin('sample-tool')?.manifest.version, '1.2.0');
  assert.equal(await registry.callService('sampleTool', 'ping', []), 'v2');

  fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = { apply() { throw new Error("bad-next"); } };');
  const zipBad = path.join(work, 'sample-tool-bad.zip');
  await execFileAsync('zip', ['-r', zipBad, 'sample-tool'], { cwd: work });
  await assert.rejects(
    () => installPluginZip({ registry, zipFilePath: zipBad, userPluginsDir: installed }),
    /bad-next/,
  );
  assert.equal(registry.getPlugin('sample-tool')?.manifest.version, '1.2.0');
  assert.equal(await registry.callService('sampleTool', 'ping', []), 'v2');

  const after = await uninstallInstalledPlugin({ registry, id: 'sample-tool', userPluginsDir: installed });
  assert.equal(after.some((item) => item.id === 'sample-tool'), false);
  assert.equal(registry.getService('sampleTool'), undefined);
  assert.equal(fs.existsSync(path.join(installed, 'sample-tool')), false);
  await assert.rejects(
    () => uninstallInstalledPlugin({ registry, id: 'sample-tool', userPluginsDir: installed }),
    /只能卸载/,
  );
});

test('不能用安装包覆盖内置插件', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const bundled = path.join(work, 'bundled');
  writePlugin(
    bundled,
    headless('sample-tool', '内置'),
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "bundled"; } }); } };',
  );
  const zipDir = path.join(work, 'sample-tool');
  writePlugin(
    zipDir,
    headless('sample-tool', '安装包'),
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "zip"; } }); } };',
  );
  const zipPath = path.join(work, 'override.zip');
  await execFileAsync('zip', ['-r', zipPath, 'sample-tool'], { cwd: work });
  const registry = new ServiceRegistry(silent);
  await registry.scanAndLoadPlugins(bundled, 'bundled');
  await assert.rejects(
    () => installPluginZip({ registry, zipFilePath: zipPath, userPluginsDir: path.join(work, 'installed') }),
    /不能覆盖安装/,
  );
  assert.equal(await registry.callService('sampleTool', 'ping', []), 'bundled');
});

test('拒绝越界压缩包', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  assert.throws(() => assertZipEntriesSafe(['../evil.txt']), /越界/);
  assert.throws(() => assertZipEntriesSafe(['ok/../../etc/passwd']), /越界/);
  const zipPath = path.join(work, 'bad.zip');
  fs.writeFileSync(zipPath, makeStoredZip([{ name: '../evil.txt', data: Buffer.from('nope') }]));
  const registry = new ServiceRegistry(silent);
  await assert.rejects(
    () => installPluginZip({ registry, zipFilePath: zipPath, userPluginsDir: path.join(work, 'installed') }),
    /越界/,
  );
  assert.equal(fs.existsSync(path.join(work, 'evil.txt')), false);
  assert.equal(registry.getPluginList().length, 0);
});
