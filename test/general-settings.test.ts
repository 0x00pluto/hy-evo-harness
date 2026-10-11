import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERAL_NAV_ID,
  generalNavMatches,
  localUserLabel,
  preferredSettingsId,
  updateCheckNote,
  updateDialogInsteadOfCheck,
} from '../src/renderer/general-settings.js';

test('没有指定插件时选中通用设置', () => {
  assert.equal(preferredSettingsId(undefined, ['alpha']), GENERAL_NAV_ID);
  assert.equal(preferredSettingsId(null, ['alpha']), GENERAL_NAV_ID);
  assert.equal(preferredSettingsId('missing', ['alpha']), GENERAL_NAV_ID);
  assert.equal(preferredSettingsId('alpha', []), GENERAL_NAV_ID);
});

test('指定了目录里的插件时选中该插件', () => {
  assert.equal(preferredSettingsId('alpha', ['alpha', 'beta']), 'alpha');
});

test('搜索命中通用设置或五行标题时保留该项', () => {
  assert.equal(generalNavMatches(''), true);
  assert.equal(generalNavMatches('  '), true);
  for (const label of ['通用设置', '产品名称', '版本', '当前用户', '用户数据目录', '已安装插件目录']) {
    assert.equal(generalNavMatches(label), true, label);
    assert.equal(generalNavMatches(label.slice(0, 2)), true, label);
  }
});

test('搜索都不命中时藏起通用设置', () => {
  assert.equal(generalNavMatches('不存在的插件字段'), false);
  assert.equal(generalNavMatches('个人设置'), false);
});

test('读不到本机账户名时显示本地用户', () => {
  assert.equal(localUserLabel('ada'), 'ada');
  assert.equal(localUserLabel('  '), '本地用户');
  assert.equal(localUserLabel(''), '本地用户');
  assert.equal(localUserLabel(null), '本地用户');
});

test('版本行短句覆盖四种检查结果', () => {
  assert.equal(updateCheckNote('upToDate'), '已是最新版本');
  assert.equal(updateCheckNote('unsupported'), '当前环境不检查更新');
  assert.equal(updateCheckNote('checking'), '正在检查…');
  assert.equal(updateCheckNote('error', '网络不可用'), '网络不可用');
  assert.equal(updateCheckNote('error', '  '), '检查更新失败');
  assert.equal(updateCheckNote('idle'), '');
  assert.equal(updateCheckNote('readyToInstall'), '');
});

test('已可安装或正在下载时不再发起检查', () => {
  assert.equal(updateDialogInsteadOfCheck('readyToInstall'), true);
  assert.equal(updateDialogInsteadOfCheck('downloading'), true);
  assert.equal(updateDialogInsteadOfCheck('installing'), true);
  assert.equal(updateDialogInsteadOfCheck('idle'), false);
  assert.equal(updateDialogInsteadOfCheck('upToDate'), false);
  assert.equal(updateDialogInsteadOfCheck('unsupported'), false);
});
