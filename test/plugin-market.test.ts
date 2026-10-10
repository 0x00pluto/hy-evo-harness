import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  assertAllowedPluginZipUrl,
  buildPluginCatalog,
  compareSemver,
  parsePluginCatalog,
  parsePluginRelease,
  pluginZipUrl,
  releaseKeysFromList,
  versionFromTag,
} from '../src/main/plugin-catalog.ts';
import { marketUpdates, readOrigins, writeOrigin, deleteOrigin } from '../src/main/plugin-origins.ts';
import { listPackPaths, packPluginRelease, shouldPackRelative } from '../src/main/plugin-pack.ts';
import { assertNoBinaryPack } from '../src/main/plugin-publish.ts';

const execFileAsync = promisify(execFile);

test('版本号只按 X.Y.Z 比较，tag 必须带 v', () => {
  assert.equal(compareSemver('1.2.0', '1.1.9'), 1);
  assert.equal(compareSemver('1.2.0', '1.2.0'), 0);
  assert.equal(compareSemver('1.2.0', '2.0.0'), -1);
  assert.equal(compareSemver('1.2', '1.2.0'), null);
  assert.equal(versionFromTag('v1.2.3'), '1.2.3');
  assert.throws(() => versionFromTag('1.2.3'), /v/);
});

test('目录只接受七牛上对得上 id 和版本的 zip', () => {
  const release = {
    id: 'manju-studio',
    displayName: '漫剧操作台',
    version: '0.1.1',
    description: '生成分镜',
    downloadUrl: pluginZipUrl('manju-studio', '0.1.1'),
    sha256: 'a'.repeat(64),
  };
  assert.equal(parsePluginRelease(release)?.id, 'manju-studio');
  assert.equal(parsePluginRelease({ ...release, downloadUrl: 'https://example.com/a.zip' }), null);
  assert.equal(parsePluginRelease({ ...release, downloadUrl: pluginZipUrl('other-plugin', '0.1.1') }), null);
  assert.throws(
    () => assertAllowedPluginZipUrl('http://oss.ai.66plat.com/dex-buddy/plugins/manju-studio/0.1.1.zip', 'manju-studio', '0.1.1'),
    /https/,
  );
  const newer = { ...release, version: '0.2.0', displayName: '新', downloadUrl: pluginZipUrl('manju-studio', '0.2.0') };
  const catalog = parsePluginCatalog({
    plugins: [release, { ...release, version: '0.1.0', downloadUrl: pluginZipUrl('manju-studio', '0.1.0') }, newer],
  });
  assert.equal(catalog.plugins.length, 1);
  assert.equal(catalog.plugins[0]?.version, '0.2.0');
  assert.equal(catalog.plugins[0]?.displayName, '新');
});

test('合成目录时每个插件只留最高版本', () => {
  const older = {
    id: 'alpha',
    displayName: '甲',
    version: '1.0.0',
    downloadUrl: pluginZipUrl('alpha', '1.0.0'),
    sha256: 'b'.repeat(64),
  };
  const newer = { ...older, version: '1.1.0', downloadUrl: pluginZipUrl('alpha', '1.1.0') };
  const catalog = buildPluginCatalog([older, newer], '2026-10-10T00:00:00.000Z');
  assert.deepEqual(catalog.plugins.map((item) => item.version), ['1.1.0']);
});

test('列举七牛键时只留下版本说明', () => {
  const text = [
    'Key\tSize',
    'dex-buddy/plugins/index.json\t1',
    'dex-buddy/plugins/manju-studio/0.1.1.json\t2',
    'dex-buddy/plugins/manju-studio/0.1.1.zip\t3',
    'dex-buddy/plugins/manju-studio/notes.json\t4',
  ].join('\n');
  assert.deepEqual(releaseKeysFromList(text), ['dex-buddy/plugins/manju-studio/0.1.1.json']);
});

test('打包跳过密钥和依赖目录，保留示例环境文件', () => {
  assert.equal(shouldPackRelative('index.js'), true);
  assert.equal(shouldPackRelative('.env'), false);
  assert.equal(shouldPackRelative('.env.example'), true);
  assert.equal(shouldPackRelative('.env.local'), false);
  assert.equal(shouldPackRelative('.git/config'), false);
  assert.equal(shouldPackRelative('.venv/bin/python'), false);
  assert.equal(shouldPackRelative('bin/darwin/worker'), false);
  assert.equal(shouldPackRelative('.next/server/app.js'), false);
  assert.equal(shouldPackRelative('src/app.py'), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-pack-'));
  fs.writeFileSync(path.join(root, 'plugin.manifest.json'), '{}');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(root, '.env.example'), 'SECRET=');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'left.js'), 'x');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.py'), 'print(1)');
  assert.deepEqual(listPackPaths(root), ['.env.example', 'plugin.manifest.json', 'src/app.py']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('按 tag 打包后校验值写进版本说明', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-pack-'));
  const source = path.join(root, 'plugin');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'plugin.manifest.json'), JSON.stringify({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.2.0',
    type: 'headless',
    main: 'index.js',
    description: '一个示例',
  }));
  fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(source, '.env'), 'SECRET=1');
  const packed = await packPluginRelease({ sourceDir: source, tag: 'v1.2.0', outDir: path.join(root, 'out') });
  assert.equal(packed.release.version, '1.2.0');
  assert.equal(packed.release.sha256.length, 64);
  const listed = await execFileAsync('unzip', ['-Z1', packed.zipPath]);
  assert.equal(listed.stdout.includes('.env'), false);
  assert.match(listed.stdout, /plugin\.manifest\.json/);
  await assert.rejects(
    () => packPluginRelease({ sourceDir: source, tag: 'v1.2.1', outDir: path.join(root, 'out') }),
    /不一致/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('只有从插件中心安装的才会提示更新', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-origin-')), 'origins.json');
  writeOrigin(file, 'sample-tool', {
    channel: 'market',
    version: '1.0.0',
    sha256: 'c'.repeat(64),
    installedAt: '2026-10-10T00:00:00.000Z',
  });
  writeOrigin(file, 'local-tool', {
    channel: 'file',
    version: '1.0.0',
    installedAt: '2026-10-10T00:00:00.000Z',
  });
  const release = {
    id: 'sample-tool',
    displayName: '示例',
    version: '1.1.0',
    downloadUrl: pluginZipUrl('sample-tool', '1.1.0'),
    sha256: 'd'.repeat(64),
  };
  const localRelease = { ...release, id: 'local-tool', downloadUrl: pluginZipUrl('local-tool', '1.1.0') };
  const notices = marketUpdates({
    catalog: [release, localRelease],
    origins: readOrigins(file),
    installed: [
      { id: 'sample-tool', version: '1.0.0', source: 'installed' },
      { id: 'local-tool', version: '1.0.0', source: 'installed' },
      { id: 'sample-tool', version: '9.0.0', source: 'bundled' },
    ],
  });
  assert.deepEqual(notices, [{ id: 'sample-tool', version: '1.0.0', remoteVersion: '1.1.0' }]);
  deleteOrigin(file, 'sample-tool');
  assert.equal(readOrigins(file)['sample-tool'], undefined);
  fs.writeFileSync(file, '{');
  assert.deepEqual(readOrigins(file), {});
});

test('发布遇到二进制打包声明时拒绝', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-publish-'));
  assert.doesNotThrow(() => assertNoBinaryPack(root));
  fs.writeFileSync(path.join(root, 'dex-buddy-plugin-pack.json'), '{}\n');
  assert.throws(() => assertNoBinaryPack(root), /已不再编译二进制/);
});
