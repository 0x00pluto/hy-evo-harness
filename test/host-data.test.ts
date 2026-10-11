import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { INSTALLED_PLUGINS_DIR_NAME, resolveHostDataPath } from '../src/main/host-data.ts';

const userData = path.resolve('/tmp/dex-user');

test('userData 种类解析为宿主用户数据目录', () => {
  assert.equal(resolveHostDataPath('userData', userData), userData);
});

test('installedPlugins 种类是用户数据目录下的 installed_plugins', () => {
  assert.equal(
    resolveHostDataPath('installedPlugins', userData),
    path.join(userData, INSTALLED_PLUGINS_DIR_NAME),
  );
  assert.equal(INSTALLED_PLUGINS_DIR_NAME, 'installed_plugins');
});

test('其它种类不能解析成路径', () => {
  for (const kind of ['', 'plugins', '../etc', '/etc', 'userData/installed_plugins', null, 1, undefined]) {
    assert.equal(resolveHostDataPath(kind, userData), null, String(kind));
  }
  assert.equal(resolveHostDataPath('userData', ''), null);
  assert.equal(resolveHostDataPath('userData', '   '), null);
});
