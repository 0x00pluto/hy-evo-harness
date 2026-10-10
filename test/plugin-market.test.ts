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
  groupReleasesByCategory,
  parsePluginCatalog,
  parsePluginRelease,
  pluginIconUrl,
  pluginInstallPath,
  pluginZipUrl,
  releaseKeysFromList,
  versionFromTag,
} from '../src/main/plugin-catalog.ts';
import { marketUpdates, readOrigins, writeOrigin, deleteOrigin } from '../src/main/plugin-origins.ts';
import { listPackPaths, packPluginRelease, parsePackPatterns, shouldPackRelative } from '../src/main/plugin-pack.ts';
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
    'dex-buddy/plugins/manju-studio/0.1.1.icon.png\t5',
    'dex-buddy/plugins/manju-studio/notes.json\t4',
  ].join('\n');
  assert.deepEqual(releaseKeysFromList(text), ['dex-buddy/plugins/manju-studio/0.1.1.json']);
});

test('目录接受可选分类和图标，非法字段丢掉但条目还在', () => {
  const release = {
    id: 'manju-studio',
    displayName: '漫剧操作台',
    version: '0.1.1',
    description: '生成分镜',
    category: ' 创作 ',
    iconUrl: pluginIconUrl('manju-studio', '0.1.1', 'png'),
    downloadUrl: pluginZipUrl('manju-studio', '0.1.1'),
    sha256: 'a'.repeat(64),
  };
  const parsed = parsePluginRelease(release);
  assert.equal(parsed?.category, '创作');
  assert.equal(parsed?.iconUrl, pluginIconUrl('manju-studio', '0.1.1', 'png'));
  assert.equal(parsePluginRelease({ ...release, category: undefined, iconUrl: undefined })?.id, 'manju-studio');

  const badIcon = parsePluginRelease({ ...release, iconUrl: 'https://example.com/icon.png' });
  assert.equal(badIcon?.id, 'manju-studio');
  assert.equal(badIcon?.iconUrl, undefined);
  assert.equal(parsePluginRelease({ ...release, iconUrl: pluginIconUrl('other', '0.1.1', 'png') })?.iconUrl, undefined);
  assert.equal(parsePluginRelease({ ...release, iconUrl: pluginIconUrl('manju-studio', '0.1.1', 'gif') })?.iconUrl, undefined);
  assert.equal(parsePluginRelease({ ...release, iconUrl: pluginIconUrl('manju-studio', '9.9.9', 'png') })?.iconUrl, undefined);

  const badCategory = parsePluginRelease({ ...release, category: 'x'.repeat(33) });
  assert.equal(badCategory?.id, 'manju-studio');
  assert.equal(badCategory?.category, undefined);
  assert.equal(parsePluginRelease({ ...release, category: '   ' })?.category, undefined);
  assert.equal(parsePluginRelease({ ...release, category: 12 })?.category, undefined);
});

test('预计路径落在用户插件目录，分类把其他放在最后', () => {
  assert.equal(pluginInstallPath('/tmp/user/installed_plugins', 'manju-studio'), path.join('/tmp/user/installed_plugins', 'manju-studio'));
  assert.throws(() => pluginInstallPath('/tmp/user/installed_plugins', '../escape'), /id/);
  const groups = groupReleasesByCategory([
    { displayName: '乙', category: '工具' },
    { displayName: '甲' },
    { displayName: '丙', category: '其他' },
    { displayName: '丁', category: '创作' },
    { displayName: '戊', category: '工具' },
  ]);
  assert.deepEqual(groups.map((group) => group.category), ['创作', '工具', '其他']);
  assert.deepEqual(groups[1]?.plugins.map((item) => item.displayName), ['戊', '乙']);
  assert.deepEqual(groups[2]?.plugins.map((item) => item.displayName), ['丙', '甲']);
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
  assert.equal(shouldPackRelative('temp/job.json'), false);
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

test('pack 决定包含范围，ignore 再挖掉，宿主排除仍然生效', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-pack-'));
  fs.writeFileSync(path.join(root, 'plugin.manifest.json'), '{}');
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  fs.writeFileSync(path.join(root, 'README.md'), '# readme');
  fs.mkdirSync(path.join(root, 'src', 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.py'), 'print(1)');
  fs.writeFileSync(path.join(root, 'src', 'notes.local.json'), '{}');
  fs.writeFileSync(path.join(root, 'src', 'nested', 'notes.local.json'), '{}');
  fs.writeFileSync(path.join(root, 'src', 'drafts', 'note.txt'), 'draft');
  fs.writeFileSync(path.join(root, 'tests', 'test.py'), 'def test(): pass');
  fs.writeFileSync(path.join(root, 'dex-buddy-plugin.pack'), [
    'plugin.manifest.json',
    'index.js',
    '.env',
    'src/',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'dex-buddy-plugin.ignore'), [
    'src/drafts/',
    'src/*.local.json',
    '',
  ].join('\n'));
  assert.deepEqual(listPackPaths(root), [
    'index.js',
    'plugin.manifest.json',
    'src/app.py',
    'src/nested/notes.local.json',
  ]);
  fs.rmSync(root, { recursive: true, force: true });
  assert.throws(() => parsePackPatterns('!src/\n', 'dex-buddy-plugin.pack'), /第 1 行无效/);
  assert.throws(() => parsePackPatterns('../secret\n', 'dex-buddy-plugin.ignore'), /第 1 行无效/);
  assert.throws(() => parsePackPatterns('/tmp/a\n', 'dex-buddy-plugin.pack'), /第 1 行无效/);
  assert.throws(() => parsePackPatterns('**/*.md\n', 'dex-buddy-plugin.ignore'), /第 1 行无效/);
});

test('漏写目录斜杠时，清单点名的入口不在包里就失败', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-pack-'));
  const source = path.join(root, 'plugin');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.mkdirSync(path.join(source, '__pycache__'));
  fs.writeFileSync(path.join(source, 'plugin.manifest.json'), JSON.stringify({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.2.0',
    type: 'headless',
    main: 'index.js',
  }));
  fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(source, 'src', 'app.py'), 'print(1)');
  fs.writeFileSync(path.join(source, '__pycache__', 'x.pyc'), 'byte');
  fs.writeFileSync(path.join(source, 'dex-buddy-plugin.pack'), 'plugin.manifest.json\nsrc\n');
  await assert.rejects(
    () => packPluginRelease({ sourceDir: source, tag: 'v1.2.0', outDir: path.join(root, 'out') }),
    /main（index\.js）/,
  );
  assert.equal(shouldPackRelative('__pycache__/x.pyc'), false);
  assert.equal(shouldPackRelative('src/app.pyc'), false);
  fs.writeFileSync(path.join(source, 'dex-buddy-plugin.pack'), '# 只有注释\n');
  assert.deepEqual(listPackPaths(source), []);
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
  assert.equal(packed.release.iconUrl, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('打包把分类和图标地址写进版本说明', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-pack-'));
  const source = path.join(root, 'plugin');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'plugin.manifest.json'), JSON.stringify({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.2.0',
    type: 'headless',
    main: 'index.js',
    category: '创作',
    icon: 'icon.png',
  }));
  fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(source, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const packed = await packPluginRelease({ sourceDir: source, tag: 'v1.2.0', outDir: path.join(root, 'out') });
  assert.equal(packed.release.category, '创作');
  assert.equal(packed.release.iconUrl, pluginIconUrl('sample-tool', '1.2.0', 'png'));
  assert.equal(packed.iconPath && fs.existsSync(packed.iconPath), true);
  const written = JSON.parse(fs.readFileSync(packed.jsonPath, 'utf8')) as { category?: string; iconUrl?: string };
  assert.equal(written.category, '创作');
  assert.equal(written.iconUrl, pluginIconUrl('sample-tool', '1.2.0', 'png'));

  fs.rmSync(path.join(source, 'icon.png'));
  const missing = await packPluginRelease({ sourceDir: source, tag: 'v1.2.0', outDir: path.join(root, 'out') });
  assert.equal(missing.release.iconUrl, undefined);
  assert.equal(missing.iconPath, undefined);
  assert.equal(missing.release.category, '创作');
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
