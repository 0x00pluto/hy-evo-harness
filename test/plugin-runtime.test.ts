import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { uninstallInstalledPlugin } from '../src/main/install.ts';
import { parseManifest } from '../src/main/manifest.ts';
import {
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

function fakeRun(calls: string[][]): CommandRunner {
  return async (_command, args) => {
    calls.push(args);
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
  const calls: string[][] = [];
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
  const venvCalls = () => calls.filter((args) => args[0] === 'venv').length;
  assert.equal(venvCalls(), 1);
  const second = await preparePluginRuntime(input);
  assert.equal(second.ok, true);
  assert.equal(venvCalls(), 1);
  fs.writeFileSync(path.join(pluginDir, 'requirements.txt'), 'openai>=1\n');
  await preparePluginRuntime(input);
  assert.equal(venvCalls(), 2);
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
  assert.match(failed?.runtimeError ?? '', /pip failed/);

  const calls: string[][] = [];
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
