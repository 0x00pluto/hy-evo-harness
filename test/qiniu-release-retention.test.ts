import assert from 'node:assert/strict';
import test from 'node:test';
import {
  objectKeysFromList,
  parseReleaseKeep,
  planReleaseRetention,
  versionFromReleaseKey,
} from '../src/main/qiniu-release-retention.ts';

test('从顶层安装包键认出版本', () => {
  assert.equal(versionFromReleaseKey('dex-buddy/dex-buddy-0.11.2-setup.exe'), '0.11.2');
  assert.equal(versionFromReleaseKey('dex-buddy/dex-buddy-0.11.2-setup.exe.blockmap'), '0.11.2');
  assert.equal(versionFromReleaseKey('dex-buddy/dex-buddy-0.11.2.dmg'), '0.11.2');
  assert.equal(versionFromReleaseKey('dex-buddy/dex-buddy-0.11.2.dmg.blockmap'), '0.11.2');
  assert.equal(versionFromReleaseKey('dex-buddy/Dex.Buddy-0.11.2-universal-mac.zip'), '0.11.2');
  assert.equal(
    versionFromReleaseKey('dex-buddy/Dex.Buddy-0.11.2-universal-mac.zip.blockmap'),
    '0.11.2',
  );
});

test('latest、子目录、认不出的文件不进安装包版本', () => {
  assert.equal(versionFromReleaseKey('dex-buddy/latest.yml'), null);
  assert.equal(versionFromReleaseKey('dex-buddy/latest-mac.yml'), null);
  assert.equal(versionFromReleaseKey('dex-buddy/plugins/foo/0.1.0.zip'), null);
  assert.equal(versionFromReleaseKey('dex-buddy/runtimes/node-v22.tar.gz'), null);
  assert.equal(versionFromReleaseKey('dex-buddy/dex-buddy-0.11.2.AppImage'), null);
  assert.equal(versionFromReleaseKey('other/dex-buddy-0.11.2.dmg'), null);
});

test('listbucket 输出取第一列键', () => {
  const text = [
    'Key\tSize',
    'dex-buddy/latest.yml\t10',
    'dex-buddy/dex-buddy-0.1.0.dmg\t20',
    'dex-buddy/plugins/a/0.1.0.zip\t30',
  ].join('\n');
  assert.deepEqual(objectKeysFromList(text), [
    'dex-buddy/latest.yml',
    'dex-buddy/dex-buddy-0.1.0.dmg',
    'dex-buddy/plugins/a/0.1.0.zip',
  ]);
});

test('按 SemVer 保留最新 3 个版本的整组，更旧的删掉', () => {
  const keys = [
    'dex-buddy/latest.yml',
    'dex-buddy/latest-mac.yml',
    'dex-buddy/plugins/x/0.1.0.zip',
    'dex-buddy/dex-buddy-0.9.0.dmg',
    'dex-buddy/dex-buddy-0.10.0.dmg',
    'dex-buddy/dex-buddy-0.11.0-setup.exe',
    'dex-buddy/dex-buddy-0.11.0.dmg',
    'dex-buddy/Dex.Buddy-0.11.0-universal-mac.zip',
    'dex-buddy/dex-buddy-0.11.1.dmg',
    'dex-buddy/dex-buddy-0.11.2.dmg',
    'dex-buddy/dex-buddy-0.11.2-setup.exe',
  ];
  const plan = planReleaseRetention(keys, { keep: 3, protectVersion: '0.11.2' });
  assert.deepEqual(plan.keepVersions, ['0.11.2', '0.11.1', '0.11.0']);
  assert.deepEqual(plan.deleteKeys, [
    'dex-buddy/dex-buddy-0.10.0.dmg',
    'dex-buddy/dex-buddy-0.9.0.dmg',
  ]);
});

test('0.10 按数字新于 0.9，不会被字符串排序弄反', () => {
  const plan = planReleaseRetention(
    [
      'dex-buddy/dex-buddy-0.9.0.dmg',
      'dex-buddy/dex-buddy-0.10.0.dmg',
      'dex-buddy/dex-buddy-0.11.0.dmg',
    ],
    { keep: 2, protectVersion: '0.11.0' },
  );
  assert.deepEqual(plan.keepVersions, ['0.11.0', '0.10.0']);
  assert.deepEqual(plan.deleteKeys, ['dex-buddy/dex-buddy-0.9.0.dmg']);
});

test('protectVersion 即使不在最新 keep 个里也保留', () => {
  const plan = planReleaseRetention(
    [
      'dex-buddy/dex-buddy-0.8.0.dmg',
      'dex-buddy/dex-buddy-0.9.0.dmg',
      'dex-buddy/dex-buddy-0.10.0.dmg',
      'dex-buddy/dex-buddy-0.11.0.dmg',
    ],
    { keep: 2, protectVersion: '0.8.0' },
  );
  assert.ok(plan.keepVersions.includes('0.8.0'));
  assert.ok(plan.keepVersions.includes('0.11.0'));
  assert.ok(plan.keepVersions.includes('0.10.0'));
  assert.deepEqual(plan.deleteKeys, ['dex-buddy/dex-buddy-0.9.0.dmg']);
});

test('QINIU_RELEASE_KEEP 只接受正整数', () => {
  assert.equal(parseReleaseKeep(undefined), 3);
  assert.equal(parseReleaseKeep('5'), 5);
  assert.throws(() => parseReleaseKeep('0'), /正整数/);
  assert.throws(() => parseReleaseKeep('abc'), /正整数/);
});
