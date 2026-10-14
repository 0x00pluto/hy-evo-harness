import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildInstallPrompt,
  guideForPlatform,
  prepareExternalTools,
  prependToolDirs,
  type PrepareExternalToolsInput,
} from '../src/main/external-tools.ts';
import { parseManifest } from '../src/main/manifest.ts';
import { ServiceRegistry } from '../src/main/registry.ts';
import type { ExternalToolSpec, Logger } from '../src/main/types.ts';

const silent: Logger = { info() {}, error() {} };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-tools-'));
}

function baseManifest(externalTools: unknown) {
  return parseManifest({
    id: 'sample-tool',
    displayName: '示例',
    version: '1.0.0',
    type: 'headless',
    externalTools,
  });
}

function input(
  tools: ExternalToolSpec[],
  extra: Partial<PrepareExternalToolsInput> = {},
): PrepareExternalToolsInput {
  return {
    tools,
    platform: 'darwin',
    pathEnv: '',
    ...extra,
  };
}

function writePlugin(dir: string, externalTools: unknown, source: string, runtime?: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  const manifest: Record<string, unknown> = {
    id: 'sample-tool',
    displayName: '示例',
    version: '1.0.0',
    type: 'headless',
    main: 'index.js',
    externalTools,
  };
  if (runtime) manifest.runtime = runtime;
  fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'index.js'), source);
  if (runtime) fs.writeFileSync(path.join(dir, 'requirements.txt'), 'PyYAML>=6\n');
}

test('非法 externalTools 指出条目，插件清单仍能解析', () => {
  const unknown = baseManifest([{ bin: 'ffmpeg', shell: 'brew install ffmpeg' }]);
  assert.match(unknown.externalToolsError ?? '', /未知字段 shell/);
  assert.equal(unknown.externalTools, undefined);

  const badBin = baseManifest([{ bin: '../ffmpeg' }]);
  assert.match(badBin.externalToolsError ?? '', /externalTools\[0\] 的 bin 无效/);

  const badGuide = baseManifest([{ bin: 'ffmpeg', guide: 'not-a-url' }]);
  assert.match(badGuide.externalToolsError ?? '', /guide/);

  const archive = baseManifest([{
    bin: 'ffmpeg',
    archive: {
      'darwin-arm64': { url: 'https://example.com/a.tar.gz', sha256: 'a'.repeat(64) },
    },
  }]);
  assert.match(archive.externalToolsError ?? '', /未知字段 archive/);

  const npm = baseManifest([{ bin: 'agent-browser', npm: 'agent-browser@1.0.0' }]);
  assert.match(npm.externalToolsError ?? '', /未知字段 npm/);

  const ok = baseManifest([{
    bin: 'ffmpeg',
    extraBins: ['ffprobe'],
    guide: 'https://ffmpeg.org/download.html',
  }]);
  assert.equal(ok.externalToolsError, undefined);
  assert.equal(ok.externalTools?.[0]?.bin, 'ffmpeg');
  assert.deepEqual(ok.externalTools?.[0]?.extraBins, ['ffprobe']);
  assert.equal(ok.externalTools?.[0]?.guide, 'https://ffmpeg.org/download.html');
});

test('缺命令时给出编号清单，不下载也不 apply', async () => {
  const result = await prepareExternalTools(input([
    {
      bin: 'agent-browser',
      guide: 'https://agent-browser.example/install',
    },
    { bin: 'ui-max' },
    {
      bin: 'lark',
      guide: {
        darwin: 'https://open.feishu.cn/document/lark-cli',
        win32: 'https://example.com/win',
      },
    },
  ]));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.message, '还没有 agent-browser、ui-max、lark');
  assert.equal(
    result.installPrompt,
    [
      '请在这台电脑上安装以下命令',
      '1. agent-browser 参考：https://agent-browser.example/install',
      '2. ui-max',
      '3. lark 参考：https://open.feishu.cn/document/lark-cli',
      '',
      '装好后用终端确认这些命令已经可用。',
    ].join('\n'),
  );
  assert.equal(result.installPrompt.includes('Apple'), false);
  assert.equal(result.installPrompt.includes('macOS'), false);
});

test('已经在 PATH 里的名字不出现在安装说明里', async () => {
  const binDir = path.join(tempDir(), 'bins');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'agent-browser'), '');
  const result = await prepareExternalTools(input([
    { bin: 'agent-browser', guide: 'https://agent-browser.example/install' },
    { bin: 'ui-max', guide: 'https://ui-max.example/install' },
  ], { pathEnv: binDir }));
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected failure');
  assert.equal(result.message, '还没有 ui-max');
  assert.match(result.installPrompt ?? '', /^请在这台电脑上安装以下命令\n1\. ui-max 参考：/);
  assert.equal(result.installPrompt?.includes('agent-browser'), false);
});

test('命令都在 PATH 时给出绝对路径且没有安装说明', async () => {
  const binDir = path.join(tempDir(), 'bins');
  fs.mkdirSync(binDir, { recursive: true });
  const ffmpeg = path.join(binDir, 'ffmpeg');
  const ffprobe = path.join(binDir, 'ffprobe');
  fs.writeFileSync(ffmpeg, '');
  fs.writeFileSync(ffprobe, '');
  const events: string[] = [];
  const result = await prepareExternalTools(input([
    {
      bin: 'ffmpeg',
      extraBins: ['ffprobe'],
      guide: 'https://ffmpeg.org/download.html',
    },
  ], {
    pathEnv: binDir,
    onProgress: (bin) => events.push(bin),
  }));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.message);
  assert.equal(result.bins.ffmpeg, path.resolve(ffmpeg));
  assert.equal(result.bins.ffprobe, path.resolve(ffprobe));
  assert.deepEqual(result.dirs, [path.resolve(binDir)]);
  assert.deepEqual(events, ['ffmpeg']);
});

test('guide 按系统挑选，正文不出现系统名', () => {
  assert.equal(
    guideForPlatform({ darwin: 'https://a.example', win32: 'https://b.example' }, 'darwin'),
    'https://a.example',
  );
  assert.equal(
    guideForPlatform({ darwin: 'https://a.example', win32: 'https://b.example' }, 'win32'),
    'https://b.example',
  );
  assert.equal(guideForPlatform({ darwin: 'https://a.example' }, 'linux'), undefined);
  assert.equal(
    buildInstallPrompt([{ name: 'ffmpeg', guide: 'https://ffmpeg.org/download.html' }]),
    [
      '请在这台电脑上安装以下命令',
      '1. ffmpeg 参考：https://ffmpeg.org/download.html',
      '',
      '装好后用终端确认这些命令已经可用。',
    ].join('\n'),
  );
});

test('清单不合法或命令缺失时不 apply，成功后 PATH 只出现在插件环境', async () => {
  const userData = tempDir();
  const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
  const marker = path.join(userData, 'applied');
  writePlugin(pluginDir, [{ bin: 'ffmpeg', npm: 'ffmpeg' }], `
    const fs = require('fs');
    module.exports = { apply() { fs.writeFileSync(${JSON.stringify(marker)}, 'yes'); } };
  `);
  const registry = new ServiceRegistry(silent);
  registry.setRuntimeHost({ userData });
  await registry.loadPluginFromDirectory(pluginDir, 'installed');
  assert.equal(fs.existsSync(marker), false);
  assert.equal(registry.getPlugin('sample-tool'), undefined);
  const failed = registry.getPluginList().find((plugin) => plugin.id === 'sample-tool');
  assert.match(failed?.runtimeError ?? '', /未知字段 npm/);
  assert.equal(failed?.installPrompt, undefined);

  writePlugin(pluginDir, [{
    bin: 'ffmpeg',
    extraBins: ['ffprobe'],
    guide: 'https://ffmpeg.org/download.html',
  }], `
    const fs = require('fs');
    module.exports = { apply() { fs.writeFileSync(${JSON.stringify(marker)}, 'yes'); } };
  `);
  registry.setRuntimeHost({
    userData,
    lookup: () => null,
  });
  await registry.retryRuntime('sample-tool');
  const missing = registry.getPluginList().find((plugin) => plugin.id === 'sample-tool');
  assert.match(missing?.runtimeError ?? '', /还没有 ffmpeg、ffprobe/);
  assert.match(missing?.installPrompt ?? '', /1\. ffmpeg 参考：https:\/\/ffmpeg\.org\/download\.html/);
  assert.match(missing?.installPrompt ?? '', /2\. ffprobe 参考：https:\/\/ffmpeg\.org\/download\.html/);

  const binDir = path.join(userData, 'bins');
  fs.mkdirSync(binDir, { recursive: true });
  const ffmpeg = path.join(binDir, 'ffmpeg');
  const ffprobe = path.join(binDir, 'ffprobe');
  fs.writeFileSync(ffmpeg, '');
  fs.writeFileSync(ffprobe, '');
  const events: Array<{ bin?: string }> = [];
  const before = process.env.PATH;
  writePlugin(pluginDir, [{ bin: 'ffmpeg', extraBins: ['ffprobe'] }], `
    const fs = require('fs');
    module.exports = {
      apply(ctx) {
        fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
          tool: ctx.tools.ffmpeg,
          envPath: ctx.pluginEnv().PATH,
        }));
      },
    };
  `);
  registry.setRuntimeHost({
    userData,
    lookup: (name) => (name === 'ffmpeg' ? ffmpeg : name === 'ffprobe' ? ffprobe : null),
    onProgress: (event) => events.push(event),
  });
  await registry.retryRuntime('sample-tool');
  assert.equal(process.env.PATH, before);
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8')) as { tool: string; envPath: string };
  assert.equal(saved.tool, path.resolve(ffmpeg));
  assert.ok(saved.envPath?.includes(path.dirname(ffmpeg)));
  assert.ok(events.some((event) => event.bin === 'ffmpeg'));
  assert.equal(registry.getPluginList().find((plugin) => plugin.id === 'sample-tool')?.installPrompt, undefined);
});

test('声明了 runtime 时命令目录在 runtime.env', async () => {
  const userData = tempDir();
  const pluginDir = path.join(userData, 'installed_plugins', 'sample-tool');
  const marker = path.join(userData, 'runtime-env');
  const binDir = path.join(userData, 'tool-bins-unique');
  fs.mkdirSync(binDir, { recursive: true });
  const ffmpeg = path.join(binDir, 'ffmpeg');
  fs.writeFileSync(ffmpeg, '');
  writePlugin(pluginDir, [{ bin: 'ffmpeg' }], `
    const fs = require('fs');
    module.exports = {
      apply(ctx) {
        fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
          runtimePath: ctx.runtime.env.PATH,
          pluginPath: ctx.pluginEnv().PATH,
        }));
      },
    };
  `, { python: { requirements: 'requirements.txt' } });
  const registry = new ServiceRegistry(silent);
  const before = process.env.PATH;
  registry.setRuntimeHost({
    userData,
    tools: { uv: 'uv', python: 'python', node: 'node', npm: 'npm' },
    lookup: (name) => (name === 'ffmpeg' ? ffmpeg : null),
    run: async (_command, args) => {
      if (args[0] === 'venv') {
        const python = path.join(String(args[1]), 'bin', 'python');
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, '');
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  await registry.loadPluginFromDirectory(pluginDir, 'installed');
  assert.equal(process.env.PATH, before);
  const saved = JSON.parse(fs.readFileSync(marker, 'utf8')) as { runtimePath: string; pluginPath: string };
  assert.match(saved.runtimePath, /tool-bins-unique/);
  assert.equal(saved.pluginPath.includes('tool-bins-unique'), false);
});

test('prependToolDirs 不改传入对象', () => {
  const base = { PATH: '/usr/bin' };
  const next = prependToolDirs(base, ['/tools/bin']);
  assert.equal(base.PATH, '/usr/bin');
  assert.match(next.PATH ?? '', /^\/tools\/bin:/);
});
