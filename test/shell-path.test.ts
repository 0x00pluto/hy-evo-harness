import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyUserSearchPath,
  buildUserSearchPath,
  collectUserSearchPath,
  expandWindowsPercent,
  extractMarkedPath,
  HOMEBREW_DIRS,
  parseRegPathValue,
} from '../src/main/shell-path.ts';

test('用户目录在前，重复目录只留一次', () => {
  const merged = buildUserSearchPath({
    platform: 'darwin',
    current: '/usr/bin:/bin:/opt/homebrew/bin',
    shellPath: '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin',
    registryPath: null,
  });
  assert.equal(merged, [
    ...HOMEBREW_DIRS,
    '/Users/me/.local/bin',
    '/usr/bin',
    '/bin',
  ].join(':'));
});

test('shell 读取失败时仍保留 Homebrew 目录和原来的 PATH', () => {
  const merged = buildUserSearchPath({
    platform: 'darwin',
    current: '/usr/bin:/bin',
    shellPath: null,
    registryPath: null,
  });
  assert.equal(merged, [...HOMEBREW_DIRS, '/usr/bin', '/bin'].join(':'));
});

test('目录末尾斜杠不算另一个目录', () => {
  const merged = buildUserSearchPath({
    platform: 'linux',
    current: '/usr/bin/',
    shellPath: '/home/me/.local/bin:/usr/bin',
    registryPath: 'C:\\ignored',
  });
  assert.equal(merged, '/home/me/.local/bin:/usr/bin');
});

test('Windows 用注册表路径，大小写重复只留一次', () => {
  const merged = buildUserSearchPath({
    platform: 'win32',
    current: 'C:\\Windows\\System32',
    shellPath: 'C:\\should-not-use',
    registryPath: 'C:\\Users\\me\\bin;C:\\Windows\\system32\\',
  });
  assert.equal(merged, 'C:\\Users\\me\\bin;C:\\Windows\\system32');
});

test('注册表读取失败时保持原来的 PATH', () => {
  const merged = buildUserSearchPath({
    platform: 'win32',
    current: 'C:\\Windows',
    shellPath: null,
    registryPath: null,
  });
  assert.equal(merged, 'C:\\Windows');
});

test('读取抛错时仍返回 Homebrew 目录和原来的 PATH', async () => {
  const merged = await collectUserSearchPath({ PATH: '/usr/bin' }, 'darwin', {
    shell: async () => {
      throw new Error('timeout');
    },
    registry: async () => {
      throw new Error('unused');
    },
  });
  assert.equal(merged, [...HOMEBREW_DIRS, '/usr/bin'].join(':'));
});

test('apply 把合并结果写回环境', async () => {
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
  await applyUserSearchPath(env, 'darwin', {
    shell: async () => '/opt/homebrew/bin:/custom/bin',
    registry: async () => {
      throw new Error('no registry');
    },
  });
  assert.equal(env.PATH, [...HOMEBREW_DIRS, '/custom/bin', '/usr/bin'].join(':'));
});

test('apply 在 Windows 上同时写入 Path', async () => {
  const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' };
  await applyUserSearchPath(env, 'win32', {
    shell: async () => 'C:\\ignored',
    registry: async () => 'C:\\Users\\me\\bin',
  });
  assert.equal(env.PATH, 'C:\\Users\\me\\bin;C:\\Windows');
  assert.equal(env.Path, env.PATH);
});

test('登录 shell 的提示文字不进入 PATH', () => {
  assert.equal(
    extractMarkedPath('welcome\nDEX_BUDDY_PATH/opt/homebrew/bin:/usr/binDEX_BUDDY_PATH\n'),
    '/opt/homebrew/bin:/usr/bin',
  );
  assert.equal(extractMarkedPath('no marks'), null);
});

test('reg query 取出 Path，并展开百分号变量', () => {
  const stdout = [
    '',
    'HKEY_CURRENT_USER\\Environment',
    '    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin',
    '',
  ].join('\r\n');
  const raw = parseRegPathValue(stdout);
  assert.equal(raw, '%USERPROFILE%\\bin');
  assert.equal(expandWindowsPercent(raw ?? '', { USERPROFILE: 'C:\\Users\\me' }), 'C:\\Users\\me\\bin');
  assert.equal(parseRegPathValue('no value here'), null);
});
