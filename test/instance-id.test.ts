import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { instanceIdForPath, isInstanceId, canonicalDirectory } from '../src/main/instance-id.ts';
import { PluginSettingsStore } from '../src/main/plugin-settings.ts';
import {
  instanceDataPaths,
  pathsAfterRemoval,
  readUnpackedPaths,
  writeUnpackedPaths,
} from '../src/main/unpacked-plugins.ts';
import type { Logger, PluginManifest } from '../src/main/types.ts';

const silent: Logger = { info() {}, error() {} };

test('同一路径的实例 id 稳定，不同路径不同', () => {
  const first = instanceIdForPath('/plugins/demo', 'linux');
  const second = instanceIdForPath('/plugins/demo/', 'linux');
  const other = instanceIdForPath('/plugins/other', 'linux');
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^dev-[0-9a-f]{32}$/);
  assert.equal(isInstanceId(first), true);
  assert.equal(first.length, 36);
});

test('Windows 上仅大小写不同的路径得到同一个实例 id', () => {
  const upper = instanceIdForPath('C:\\Plugins\\Foo', 'win32');
  const lower = instanceIdForPath('c:\\plugins\\foo\\', 'win32');
  assert.equal(upper, lower);
  assert.notEqual(
    instanceIdForPath('C:\\Plugins\\Foo', 'linux'),
    instanceIdForPath('c:\\plugins\\foo', 'linux'),
  );
});

test('真实路径与指向它的符号链接算出同一个实例 id', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-instance-'));
  const target = path.join(root, 'plugin');
  const link = path.join(root, 'link');
  fs.mkdirSync(target);
  fs.symlinkSync(target, link);
  try {
    assert.equal(canonicalDirectory(link), canonicalDirectory(target));
    assert.equal(instanceIdForPath(canonicalDirectory(link)), instanceIdForPath(canonicalDirectory(target)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('移除只碰实例 id，清单 id 的设置和数据目录还在', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-remove-'));
  const instanceId = instanceIdForPath('/plugins/local-foo', 'linux');
  const manifestId = 'foo';
  const localPaths = instanceDataPaths(userData, instanceId);
  const installedPaths = instanceDataPaths(userData, manifestId);
  try {
    for (const target of [localPaths.runtimeDir, localPaths.dataDir, localPaths.previewDir]) {
      assert.ok(target.includes(instanceId));
      assert.equal(target.includes(`${path.sep}${manifestId}${path.sep}`), false);
      assert.notEqual(target, installedPaths.dataDir);
      assert.notEqual(target, installedPaths.runtimeDir);
    }

    const manifest: PluginManifest = {
      id: manifestId,
      displayName: 'Foo',
      version: '1.0.0',
      type: 'headless',
      configSchema: { TOKEN: { type: 'string', title: 'Token' } },
    };
    const store = new PluginSettingsStore(path.join(userData, 'plugin-settings.json'), silent);
    assert.equal(store.save(manifest, { values: { TOKEN: 'installed' } }).ok, true);
    assert.equal(store.save(manifest, { values: { TOKEN: 'local' } }, instanceId).ok, true);
    store.deletePlugin(instanceId);
    assert.equal(store.getPluginConfig(manifest).TOKEN, 'installed');
    assert.equal(store.getPluginConfig(manifest, instanceId).TOKEN, '');
    const onDisk = JSON.parse(fs.readFileSync(path.join(userData, 'plugin-settings.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(onDisk[manifestId], { TOKEN: 'installed' });
    assert.equal(Object.prototype.hasOwnProperty.call(onDisk, instanceId), false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('父目录移除一个插件后，剩下的兄弟改写成各自的根', () => {
  const parent = '/plugins/all';
  const removed = '/plugins/all/a';
  const sibling = '/plugins/all/b';
  assert.deepEqual(
    pathsAfterRemoval([parent, '/elsewhere'], parent, removed, [sibling]),
    ['/elsewhere', sibling],
  );
  assert.deepEqual(pathsAfterRemoval([removed], removed, removed, []), []);
  assert.deepEqual(
    pathsAfterRemoval(['/plugins/all/b'], '/plugins/all', '/plugins/all/b', []),
    [],
  );
});

test('unpacked-plugins.json 只保存路径列表', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-unpacked-'));
  const filePath = path.join(dir, 'unpacked-plugins.json');
  try {
    writeUnpackedPaths(filePath, ['/plugins/demo']);
    assert.deepEqual(readUnpackedPaths(filePath), ['/plugins/demo']);
    writeUnpackedPaths(filePath, []);
    assert.deepEqual(readUnpackedPaths(filePath), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
