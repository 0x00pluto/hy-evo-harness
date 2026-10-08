import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractMacDmgInfo,
  macDmgFileName,
  resolveMacDmgUrl,
} from '../src/main/update-assets.ts';

test('mac dmg 文件名与安装包模板一致', () => {
  assert.equal(macDmgFileName('0.2.0'), 'dex-buddy-0.2.0.dmg');
});

test('相对路径补成 GitHub Release 下载地址', () => {
  assert.equal(
    resolveMacDmgUrl('0.2.0', 'dex-buddy-0.2.0.dmg'),
    'https://github.com/0x00pluto/hy-evo-harness/releases/download/v0.2.0/dex-buddy-0.2.0.dmg',
  );
});

test('绝对地址保持原样', () => {
  const url = 'https://github.com/0x00pluto/hy-evo-harness/releases/download/v0.2.0/dex-buddy-0.2.0.dmg';
  assert.equal(resolveMacDmgUrl('0.2.0', url), url);
});

test('从更新元数据里挑出 dmg', () => {
  const info = extractMacDmgInfo({
    version: '0.2.0',
    files: [
      { url: 'dex-buddy-0.2.0-mac.zip', size: 10 },
      { url: 'dex-buddy-0.2.0.dmg', size: 20 },
    ],
  });
  assert.equal(
    info.url,
    'https://github.com/0x00pluto/hy-evo-harness/releases/download/v0.2.0/dex-buddy-0.2.0.dmg',
  );
  assert.equal(info.size, 20);
});

test('元数据没有 dmg 时回退到约定文件名', () => {
  const info = extractMacDmgInfo({
    version: '0.2.0',
    files: [{ url: 'dex-buddy-0.2.0-mac.zip' }],
  });
  assert.equal(info.url.endsWith('/dex-buddy-0.2.0.dmg'), true);
  assert.equal(info.size, null);
});
