import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { installPluginZip, uninstallInstalledPlugin } from '../src/main/install.ts';
import { parseManifest, readManifestFile } from '../src/main/manifest.ts';
import { PluginSettingsStore } from '../src/main/plugin-settings.ts';
import { ServiceRegistry } from '../src/main/registry.ts';
import type { Logger, PluginManifest } from '../src/main/types.ts';

const execFileAsync = promisify(execFile);
const silent: Logger = { info() {}, error() {} };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-settings-'));
}

function writePlugin(dir: string, manifest: unknown, source: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), source);
}

const probeSource = `
module.exports = {
  apply(ctx) {
    ctx.registerService('probe', {
      config() { return ctx.getPluginConfig(); },
      env() { return ctx.pluginEnv(); },
    });
  },
};
`;

function baseManifest(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    displayName: id,
    version: '1.0.0',
    type: 'headless',
    main: 'index.js',
    ...extra,
  };
}

function validSchema(): Record<string, unknown> {
  return {
    TOKEN: { type: 'string', title: '密钥', secret: true, default: '' },
    NOTE: { type: 'string', title: '备注', default: '' },
    ENABLED: { type: 'boolean', title: '启用', default: false },
    MAX_RETRY: { type: 'number', title: '最大重试次数', default: 3 },
    ENGINE: { type: 'select', title: '引擎', options: ['edge-tts', 'azure-tts'], default: 'edge-tts' },
    OUTPUT_DIR: { type: 'path', title: '输出目录', default: '' },
  };
}

test('合法 configSchema 可解析，settingsEntry 拒绝越界路径', () => {
  const manifest = parseManifest(baseManifest('demo', {
    settingsEntry: 'ui/settings.html',
    configSchema: validSchema(),
  }));
  assert.equal(manifest.settingsEntry, 'ui/settings.html');
  assert.equal(manifest.configSchemaError, undefined);
  assert.equal(manifest.configSchema?.ENGINE?.default, 'edge-tts');
  assert.equal(manifest.configSchema?.TOKEN?.secret, true);
  assert.throws(
    () => parseManifest(baseManifest('demo', { settingsEntry: '../secret.html' })),
    /settingsEntry/,
  );
  const broken = parseManifest(baseManifest('demo', {
    configSchema: { 'not-a-key': { type: 'string', title: '坏键' } },
  }));
  assert.equal(broken.configSchema, undefined);
  assert.match(broken.configSchemaError ?? '', /键名无效/);
  const secretOnNumber = parseManifest(baseManifest('demo', {
    configSchema: { MAX_RETRY: { type: 'number', title: '次数', secret: true, default: 1 } },
  }));
  assert.match(secretOnNumber.configSchemaError ?? '', /只有字符串可以设为密钥/);
});

test('非法声明仍能加载，且不会把配置注入环境', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'plugin-settings.json');
  fs.writeFileSync(file, JSON.stringify({
    'bad-plugin': { not_a_key: 'should-not-inject', TOKEN: 'also-hidden' },
  }));
  writePlugin(
    path.join(root, 'bad-plugin'),
    baseManifest('bad-plugin', { configSchema: { 'not-a-key': { type: 'string', title: '坏键' } } }),
    probeSource,
  );
  const registry = new ServiceRegistry(silent, new PluginSettingsStore(file, silent));
  await registry.scanAndLoadPlugins(root, 'bundled');
  assert.equal(registry.getPlugin('bad-plugin')?.manifest.configSchema, undefined);
  assert.match(registry.getPlugin('bad-plugin')?.manifest.configSchemaError ?? '', /键名无效/);
  const probe = registry.getService<{ config: () => unknown; env: () => NodeJS.ProcessEnv }>('probe');
  assert.ok(probe);
  assert.deepEqual(probe.config(), {});
  const env = probe.env();
  assert.equal(env.not_a_key, undefined);
  assert.equal(env.TOKEN, process.env.TOKEN);
  assert.notEqual(env.TOKEN, 'also-hidden');
  assert.equal(process.env.not_a_key, undefined);
  const view = registry.settingsView('bad-plugin');
  assert.match(view.schemaError ?? '', /键名无效/);
  assert.deepEqual(view.fields, []);
});

test('类型不合法时不写盘，密钥留空保留、清除后为空，视图不含明文', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'plugin-settings.json');
  const manifest = parseManifest(baseManifest('demo', { configSchema: validSchema() }));
  const store = new PluginSettingsStore(file, silent);
  const registry = new ServiceRegistry(silent, store);
  writePlugin(path.join(root, 'demo'), manifest, probeSource);
  await registry.scanAndLoadPlugins(root, 'bundled');

  const saved = registry.savePluginSettings('demo', {
    values: { NOTE: 'hello', ENABLED: true, MAX_RETRY: 4, ENGINE: 'azure-tts', OUTPUT_DIR: '/tmp/out' },
    secrets: { TOKEN: { action: 'set', value: 'super-secret' } },
  });
  assert.equal(saved.ok, true);

  const probe = registry.getService<{ config: () => Record<string, unknown>; env: () => NodeJS.ProcessEnv }>('probe');
  assert.equal(probe?.config().TOKEN, 'super-secret');
  const view = registry.settingsView('demo');
  const token = view.fields.find((field) => field.key === 'TOKEN');
  assert.equal(token?.secretSet, true);
  assert.equal('value' in (token ?? {}), false);
  assert.equal(JSON.stringify(view).includes('super-secret'), false);

  const beforeKeep = fs.readFileSync(file, 'utf8');
  const kept = registry.savePluginSettings('demo', {
    values: { NOTE: 'hello', ENABLED: true, MAX_RETRY: 4, ENGINE: 'azure-tts', OUTPUT_DIR: '/tmp/out' },
    secrets: { TOKEN: { action: 'keep' } },
  });
  assert.equal(kept.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).demo.TOKEN, 'super-secret');

  const beforeInvalid = fs.readFileSync(file, 'utf8');
  const invalid = registry.savePluginSettings('demo', {
    values: { NOTE: 'changed', ENABLED: true, MAX_RETRY: 'nope', ENGINE: 'azure-tts', OUTPUT_DIR: '/tmp/out' },
    secrets: { TOKEN: { action: 'set', value: 'next-secret' } },
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.match(invalid.message, /最大重试次数/);
    assert.equal(invalid.message.includes('next-secret'), false);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), beforeInvalid);
  assert.equal(beforeKeep.includes('super-secret'), true);

  const cleared = registry.savePluginSettings('demo', {
    values: { NOTE: 'hello', ENABLED: true, MAX_RETRY: 4, ENGINE: 'nope', OUTPUT_DIR: '/tmp/out' },
    secrets: { TOKEN: { action: 'clear' } },
  });
  assert.equal(cleared.ok, false);
  if (!cleared.ok) assert.match(cleared.message, /引擎/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).demo.TOKEN, 'super-secret');

  const clearedOk = registry.savePluginSettings('demo', {
    values: { NOTE: 'hello', ENABLED: true, MAX_RETRY: 4, ENGINE: 'azure-tts', OUTPUT_DIR: '/tmp/out' },
    secrets: { TOKEN: { action: 'clear' } },
  });
  assert.equal(clearedOk.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).demo.TOKEN, '');
  assert.equal(registry.settingsView('demo').fields.find((field) => field.key === 'TOKEN')?.secretSet, false);
});

test('pluginEnv 不改宿主环境，也不带上其他插件的键', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hostKey = 'DEX_BUDDY_SETTINGS_HOST';
  const previousHost = process.env[hostKey];
  const previousToken = process.env.TOKEN;
  process.env[hostKey] = 'from-host';
  process.env.TOKEN = 'from-host-token';
  t.after(() => {
    if (previousHost === undefined) delete process.env[hostKey];
    else process.env[hostKey] = previousHost;
    if (previousToken === undefined) delete process.env.TOKEN;
    else process.env.TOKEN = previousToken;
  });

  const file = path.join(root, 'plugin-settings.json');
  writePlugin(path.join(root, 'alpha'), baseManifest('alpha', {
    configSchema: {
      TOKEN: { type: 'string', title: '密钥', secret: true, default: '' },
      ENABLED: { type: 'boolean', title: '启用', default: true },
      MAX_RETRY: { type: 'number', title: '次数', default: 3 },
    },
  }), probeSource.replaceAll("'probe'", "'alphaProbe'"));
  writePlugin(path.join(root, 'beta'), baseManifest('beta', {
    configSchema: {
      OTHER_TOKEN: { type: 'string', title: '别人的键', default: 'beta-value' },
    },
  }), probeSource.replaceAll("'probe'", "'betaProbe'"));

  const registry = new ServiceRegistry(silent, new PluginSettingsStore(file, silent));
  await registry.scanAndLoadPlugins(root, 'bundled');
  assert.equal(registry.savePluginSettings('alpha', {
    values: { ENABLED: false, MAX_RETRY: 8 },
    secrets: { TOKEN: { action: 'set', value: 'alpha-secret' } },
  }).ok, true);

  const alpha = registry.getService<{ env: () => NodeJS.ProcessEnv }>('alphaProbe');
  const beta = registry.getService<{ env: () => NodeJS.ProcessEnv }>('betaProbe');
  const alphaEnv = alpha?.env();
  const betaEnv = beta?.env();
  assert.equal(process.env.TOKEN, 'from-host-token');
  assert.equal(process.env[hostKey], 'from-host');
  assert.equal(process.env.OTHER_TOKEN, undefined);
  assert.equal(alphaEnv?.TOKEN, 'alpha-secret');
  assert.equal(alphaEnv?.ENABLED, 'false');
  assert.equal(alphaEnv?.MAX_RETRY, '8');
  assert.equal(alphaEnv?.[hostKey], 'from-host');
  assert.equal(alphaEnv?.OTHER_TOKEN, undefined);
  assert.equal(betaEnv?.OTHER_TOKEN, 'beta-value');
  assert.equal(betaEnv?.TOKEN, 'from-host-token');
  assert.equal(process.env.TOKEN, 'from-host-token');
});

test('损坏的配置文件按空配置启动，日志不包含文件内容', (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'plugin-settings.json');
  const planted = 'SUPERSECRET-DO-NOT-LOG';
  fs.writeFileSync(file, `{not-json ${planted}`);
  const errors: string[] = [];
  const logger: Logger = { info() {}, error(msg) { errors.push(msg); } };
  const store = new PluginSettingsStore(file, logger);
  const manifest = parseManifest(baseManifest('demo', {
    configSchema: { TOKEN: { type: 'string', title: '密钥', default: '' } },
  })) ;
  assert.deepEqual(store.getPluginConfig(manifest), { TOKEN: '' });
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? '', /无法读取/);
  assert.equal(errors[0]?.includes(planted), false);
});

test('卸载已安装插件才删除配置，失败时保留；覆盖安装不改配置文件', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const settingsFile = path.join(work, 'plugin-settings.json');
  const original = `${JSON.stringify({
    'sample-tool': { TOKEN: 'keep-across-reinstall' },
    'other-tool': { OTHER: 'stay' },
  }, null, 2)}\n`;
  fs.writeFileSync(settingsFile, original);

  const pluginDir = path.join(work, 'sample-tool');
  writePlugin(
    pluginDir,
    baseManifest('sample-tool'),
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "v1"; } }); } };',
  );
  const zipV1 = path.join(work, 'v1.zip');
  await execFileAsync('zip', ['-r', zipV1, 'sample-tool'], { cwd: work });
  const installed = path.join(work, 'installed');
  const store = new PluginSettingsStore(settingsFile, silent);
  const registry = new ServiceRegistry(silent, store);
  await installPluginZip({ registry, zipFilePath: zipV1, userPluginsDir: installed });
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);

  fs.writeFileSync(
    path.join(pluginDir, 'index.js'),
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "v2"; } }); } };',
  );
  const zipV2 = path.join(work, 'v2.zip');
  await execFileAsync('zip', ['-r', zipV2, 'sample-tool'], { cwd: work });
  await installPluginZip({ registry, zipFilePath: zipV2, userPluginsDir: installed });
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);
  assert.equal(await registry.callService('sampleTool', 'ping', []), 'v2');

  const bundled = path.join(work, 'bundled');
  writePlugin(bundled, baseManifest('built-in', { displayName: '内置' }) as PluginManifest, 'module.exports = { apply() {} };');
  const bundledRegistry = new ServiceRegistry(silent, store);
  await bundledRegistry.scanAndLoadPlugins(bundled, 'bundled');
  fs.writeFileSync(settingsFile, original);
  await assert.rejects(
    () => uninstallInstalledPlugin({ registry: bundledRegistry, id: 'built-in', userPluginsDir: installed }),
    /只能卸载/,
  );
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);

  await uninstallInstalledPlugin({ registry, id: 'sample-tool', userPluginsDir: installed });
  const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as Record<string, unknown>;
  assert.equal(after['sample-tool'], undefined);
  assert.deepEqual(after['other-tool'], { OTHER: 'stay' });
});

test('分组可选，空分组当作没写，非法分组使声明失败', () => {
  const manifest = parseManifest(baseManifest('demo', {
    configSchema: {
      NOTE: { type: 'string', title: '备注', default: '', group: ' 模型 ' },
      TOKEN: { type: 'string', title: '密钥', secret: true, default: '', group: '' },
    },
  }));
  assert.equal(manifest.configSchemaError, undefined);
  assert.equal(manifest.configSchema?.NOTE?.group, '模型');
  assert.equal(manifest.configSchema?.TOKEN?.group, undefined);

  const tooLong = parseManifest(baseManifest('demo', {
    configSchema: { NOTE: { type: 'string', title: '备注', group: '名'.repeat(33) } },
  }));
  assert.match(tooLong.configSchemaError ?? '', /分组/);

  const badType = parseManifest(baseManifest('demo', {
    configSchema: { NOTE: { type: 'string', title: '备注', group: 1 } },
  }));
  assert.match(badType.configSchemaError ?? '', /分组/);
});

test('设置视图带图标地址，reveal 只返回密钥明文', async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'plugin-settings.json');
  const pluginDir = path.join(root, 'demo');
  writePlugin(pluginDir, baseManifest('demo', {
    icon: 'icon.png',
    configSchema: {
      TOKEN: { type: 'string', title: '密钥', secret: true, default: '' },
      NOTE: { type: 'string', title: '备注', default: 'plain', group: '模型' },
    },
  }), probeSource);
  fs.writeFileSync(path.join(pluginDir, 'icon.png'), 'icon');
  const registry = new ServiceRegistry(silent, new PluginSettingsStore(file, silent));
  await registry.scanAndLoadPlugins(root, 'bundled');
  assert.equal(registry.savePluginSettings('demo', {
    values: { NOTE: 'plain' },
    secrets: { TOKEN: { action: 'set', value: 'super-secret' } },
  }).ok, true);

  const view = registry.settingsView('demo');
  assert.equal(view.iconUrl, 'app-plugin://demo/icon.png');
  assert.equal(view.fields.find((field) => field.key === 'NOTE')?.group, '模型');
  const token = view.fields.find((field) => field.key === 'TOKEN');
  assert.equal(token?.secretSet, true);
  assert.equal(token?.group, undefined);
  assert.equal('value' in (token ?? {}), false);
  assert.equal(JSON.stringify(view).includes('super-secret'), false);

  const probe = registry.getService<{ config: () => Record<string, unknown> }>('probe');
  assert.equal(probe?.config().TOKEN, 'super-secret');
  assert.equal(probe?.config().group, undefined);

  assert.deepEqual(registry.revealPluginSecret('demo', 'TOKEN'), { ok: true, value: 'super-secret' });
  assert.deepEqual(registry.revealPluginSecret('demo', 'NOTE'), { ok: false });
  assert.deepEqual(registry.revealPluginSecret('missing', 'TOKEN'), { ok: false });
});

test('示例插件声明了可显示的配置字段', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = readManifestFile(path.join(repoRoot, 'plugins/ai-comic-master'));
  assert.equal(manifest.configSchemaError, undefined);
  assert.equal(manifest.configSchema?.COMIC_STYLE?.type, 'select');
  assert.equal(manifest.configSchema?.OUTPUT_DIR?.type, 'path');
  assert.equal(manifest.configSchema?.MAX_RETRY?.default, 3);
});
