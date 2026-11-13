import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uninstallInstalledPlugin } from '../src/main/install.ts';
import { parseManifest } from '../src/main/manifest.ts';
import {
  OFFICIAL_PYPI_INDEX,
  PYTHON_DEPS_FAILED_MESSAGE,
  isOfficialPypiIndex,
  isPypiIndexFetchFailure,
  pluginDataDir,
  pluginRuntimeDir,
  preparePluginRuntime,
  type CommandRunner,
} from '../src/main/plugin-runtime.ts';
import { ServiceRegistry } from '../src/main/registry.ts';
import type { Logger } from '../src/main/types.ts';

const silent: Logger = { info() {}, error() {} };
const tools = { uv: 'uv', python: 'python', node: 'node', npm: 'npm' };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-runtime-'));
}

function writePlugin(dir: string, runtime: unknown, source = 'module.exports = { apply() {} };'): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.0.0',
    type: 'headless',
    main: 'index.js',
    runtime,
  }));
  fs.writeFileSync(path.join(dir, 'index.js'), source);
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'PyYAML>=6\n');
}

/** @typedef {{ args: string[]; index: string }} RunCall */

function fakeRun(calls: RunCall[]): CommandRunner {
  return async (_command, args, options) => {
    calls.push({
      args,
      index: typeof options?.env?.UV_DEFAULT_INDEX === 'string' ? options.env.UV_DEFAULT_INDEX : '',
    });
    if (args[0] === 'venv') {
      const python = path.join(String(args[1]), 'bin', 'python');
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, '');
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

test('清单里的运行时不写解释器版本', () => {
  const manifest = parseManifest({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.0.0',
    type: 'headless',
    runtime: {
      python: { requirements: 'requirements.txt' },
      node: { package: 'package.json' },
    },
  });
  assert.deepEqual(manifest.runtime, {
    python: { requirements: 'requirements.txt' },
    node: { package: 'package.json' },
  });
  assert.throws(() => parseManifest({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.0.0',
    type: 'headless',
    runtime: { python: { requirements: 'requirements.txt', version: '3.11' } },
  }), /未知字段/);
});

test('依赖没变时跳过安装，变了才重装', async () => {
  const userData = tempDir();
  const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
  writePlugin(pluginDir);
  /** @type {RunCall[]} */
  const calls = [];
  const input = {
    userData,
    pluginDir,
    source: 'installed' as const,
    spec: { python: { requirements: 'requirements.txt' } },
    tools,
    run: fakeRun(calls),
  };
  const first = await preparePluginRuntime(input);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.bins?.python, path.join(pluginRuntimeDir(userData, 'sample-tool'), 'env', 'bin', 'python'));
  const venvCalls = () => calls.filter((item) => item.args[0] === 'venv').length;
  assert.equal(venvCalls(), 1);
  const second = await preparePluginRuntime(input);
  assert.equal(second.ok, true);
  assert.equal(venvCalls(), 1);
  fs.writeFileSync(path.join(pluginDir, 'requirements.txt'), 'openai>=1\n');
  await preparePluginRuntime(input);
  assert.equal(venvCalls(), 2);
});

test('默认镜像 403 时同一次改官方源再装', async () => {
  const userData = tempDir();
  const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
  writePlugin(pluginDir);
  /** @type {RunCall[]} */
  const calls = [];
  let pipAttempts = 0;
  const run: CommandRunner = async (_command, args, options) => {
    const index = typeof options?.env?.UV_DEFAULT_INDEX === 'string' ? options.env.UV_DEFAULT_INDEX : '';
    calls.push({ args, index });
    if (args[0] === 'venv') {
      const python = path.join(String(args[1]), 'bin', 'python');
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, '');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'pip') {
      pipAttempts += 1;
      if (pipAttempts === 1) {
        return {
          code: 1,
          stdout: '',
          stderr: 'Failed to download https://pypi.tuna.tsinghua.edu.cn/.../pyyaml.whl: 403 Forbidden',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const result = await preparePluginRuntime({
    userData,
    pluginDir,
    source: 'installed',
    spec: { python: { requirements: 'requirements.txt' } },
    tools,
    run,
  });
  assert.equal(result.ok, true);
  assert.equal(pipAttempts, 2);
  const pipIndexes = calls.filter((item) => item.args[0] === 'pip').map((item) => item.index);
  assert.equal(isOfficialPypiIndex(pipIndexes[1] ?? ''), true);
  assert.equal(pipIndexes[1], OFFICIAL_PYPI_INDEX);
});

test('已是官方索引时 403 不二次尝试', async () => {
  const previous = process.env.DEX_BUDDY_PYPI_INDEX;
  process.env.DEX_BUDDY_PYPI_INDEX = OFFICIAL_PYPI_INDEX;
  try {
    const userData = tempDir();
    const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
    writePlugin(pluginDir);
    let pipAttempts = 0;
    const run: CommandRunner = async (_command, args) => {
      if (args[0] === 'venv') {
        const python = path.join(String(args[1]), 'bin', 'python');
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, '');
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'pip') {
        pipAttempts += 1;
        return { code: 1, stdout: '', stderr: '403 Forbidden' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const result = await preparePluginRuntime({
      userData,
      pluginDir,
      source: 'installed',
      spec: { python: { requirements: 'requirements.txt' } },
      tools,
      run,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, PYTHON_DEPS_FAILED_MESSAGE);
    assert.equal(pipAttempts, 1);
  } finally {
    if (previous === undefined) delete process.env.DEX_BUDDY_PYPI_INDEX;
    else process.env.DEX_BUDDY_PYPI_INDEX = previous;
  }
});

test('两源皆失败时首层是依赖没装上', async () => {
  const userData = tempDir();
  const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
  writePlugin(pluginDir);
  const run: CommandRunner = async (_command, args) => {
    if (args[0] === 'venv') {
      const python = path.join(String(args[1]), 'bin', 'python');
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, '');
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'pip') {
      return { code: 1, stdout: '', stderr: 'Failed to download wheel: 403 Forbidden' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const result = await preparePluginRuntime({
    userData,
    pluginDir,
    source: 'installed',
    spec: { python: { requirements: 'requirements.txt' } },
    tools,
    run,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.message, PYTHON_DEPS_FAILED_MESSAGE);
});

test('识别 403 与下载失败才可换源', () => {
  assert.equal(isPypiIndexFetchFailure('HTTP 403 Forbidden'), true);
  assert.equal(isPypiIndexFetchFailure('Failed to download package'), true);
  assert.equal(isPypiIndexFetchFailure('Invalid requirement syntax'), false);
  assert.equal(isOfficialPypiIndex('https://pypi.org/simple/'), true);
});

test('安装失败时不执行 apply，卸载删掉运行环境并留下数据', async () => {
  const userData = tempDir();
  const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
  const marker = path.join(userData, 'applied');
  writePlugin(pluginDir, { python: { requirements: 'requirements.txt' } }, `
    const fs = require('fs');
    module.exports = { apply() { fs.writeFileSync(${JSON.stringify(marker)}, 'yes'); } };
  `);
  const registry = new ServiceRegistry(silent);
  registry.setRuntimeHost({
    userData,
    tools,
    run: async () => ({ code: 1, stdout: '', stderr: 'pip failed' }),
  });
  await registry.loadPluginFromDirectory(pluginDir, 'installed');
  assert.equal(registry.getPlugin('sample-tool'), undefined);
  assert.equal(fs.existsSync(marker), false);
  const failed = registry.getPluginList().find((plugin) => plugin.id === 'sample-tool');
  assert.equal(failed?.runtimeError, PYTHON_DEPS_FAILED_MESSAGE);

  /** @type {RunCall[]} */
  const calls = [];
  registry.setRuntimeHost({ userData, tools, run: fakeRun(calls) });
  const retried = await registry.retryRuntime('sample-tool');
  assert.equal(retried, null);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'yes');
  assert.equal(registry.getPlugin('sample-tool')?.runtimeBins?.python?.endsWith(`${path.sep}bin${path.sep}python`), true);

  fs.mkdirSync(path.join(pluginDataDir(userData, 'sample-tool'), 'output'), { recursive: true });
  fs.writeFileSync(path.join(pluginDataDir(userData, 'sample-tool'), 'output', 'keep.txt'), 'stay');
  await uninstallInstalledPlugin({
    registry,
    id: 'sample-tool',
    userPluginsDir: path.join(userData, 'installed_plugins'),
  });
  assert.equal(fs.existsSync(pluginRuntimeDir(userData, 'sample-tool')), false);
  assert.equal(fs.readFileSync(path.join(pluginDataDir(userData, 'sample-tool'), 'output', 'keep.txt'), 'utf8'), 'stay');
});
