import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { PluginDirs, PluginRuntimeSpec, PluginSource } from './types.ts';

/** 全机共用。升级解释器时改这里并发一版 Dex Buddy，已建环境会按新常量重建。 */
export const UV_VERSION = '0.9.2';
export const PYTHON_VERSION = '3.12.12';
export const NODE_VERSION = '22.21.0';

export const RUNTIME_CDN_BASE = 'https://oss.ai.66plat.com/dex-buddy/runtimes';

export const RUNTIME_ARCHES = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64'] as const;

export type RuntimeArch = (typeof RUNTIME_ARCHES)[number];

export type RuntimeKind = 'uv' | 'python' | 'node';

const STAMP_FILE = 'install.json';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export interface RuntimeTools {
  uv: string;
  python: string;
  node: string;
  npm: string;
}

export interface PrepareRuntimeInput {
  userData: string | null;
  pluginDir: string;
  source: PluginSource;
  spec?: PluginRuntimeSpec;
  run?: CommandRunner;
  tools?: RuntimeTools;
  onProgress?: () => void;
}

export type PrepareRuntimeResult =
  | { ok: true; dirs: PluginDirs; bins?: { python?: string; node?: string } }
  | { ok: false; message: string };

interface InstallStamp {
  uv: string;
  python: string;
  node: string;
  requirementsHash: string | null;
  packageHash: string | null;
}

export function pypiIndex(): string {
  return process.env.DEX_BUDDY_PYPI_INDEX || 'https://pypi.tuna.tsinghua.edu.cn/simple';
}

export function npmRegistry(): string {
  return process.env.DEX_BUDDY_NPM_REGISTRY || 'https://registry.npmmirror.com';
}

export function runtimeArch(): RuntimeArch {
  const key = `${process.platform}-${process.arch}`;
  if (!isRuntimeArch(key)) {
    throw new Error(`没有 ${key} 的运行时`);
  }
  return key;
}

export function isRuntimeArch(value: string): value is RuntimeArch {
  return (RUNTIME_ARCHES as readonly string[]).includes(value);
}

/** 客户端下载路径和七牛对象键共用这一段，避免发版传上去的文件名和运行时要的不一致。 */
export function runtimeRelativePath(kind: RuntimeKind, arch: RuntimeArch): string {
  if (kind === 'uv') {
    const ext = arch.startsWith('win32') ? '.exe' : '';
    return `uv/${UV_VERSION}/uv-${arch}${ext}`;
  }
  if (kind === 'python') {
    return `python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-${arch}.tar.gz`;
  }
  return `node/${NODE_VERSION}/node-v${NODE_VERSION}-${arch}.tar.gz`;
}

export function runtimeDownloadUrl(kind: RuntimeKind, arch: RuntimeArch): string {
  return `${RUNTIME_CDN_BASE}/${runtimeRelativePath(kind, arch)}`;
}

export function runtimeQiniuKey(kind: RuntimeKind, arch: RuntimeArch): string {
  return `dex-buddy/runtimes/${runtimeRelativePath(kind, arch)}`;
}

export function pluginRuntimeDir(userData: string, pluginId: string): string {
  return path.join(userData, 'plugin-runtime', pluginId);
}

export function pluginDataDir(userData: string, pluginId: string): string {
  return path.join(userData, 'plugin-data', pluginId);
}

export function spawnCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function venvPython(envDir: string): string {
  return process.platform === 'win32'
    ? path.join(envDir, 'Scripts', 'python.exe')
    : path.join(envDir, 'bin', 'python');
}

export function devPython(pluginDir: string): string | null {
  const candidate = venvPython(path.join(pluginDir, '.venv'));
  return fs.existsSync(candidate) ? candidate : null;
}

export async function preparePluginRuntime(input: PrepareRuntimeInput): Promise<PrepareRuntimeResult> {
  const pluginId = readPluginId(input.pluginDir);
  const dirs = resolveDirs(input.userData, input.pluginDir, input.source, pluginId);
  if (input.source === 'installed' && input.userData) {
    fs.mkdirSync(dirs.data, { recursive: true });
    fs.mkdirSync(dirs.cache, { recursive: true });
  }
  if (!input.spec) return { ok: true, dirs };

  input.onProgress?.();
  const run = input.run ?? spawnCommand;
  try {
    if (input.source !== 'installed') {
      return await prepareDevRuntime(input, dirs, run);
    }
    if (!input.userData) return { ok: false, message: '宿主没有用户数据目录' };
    const tools = input.tools ?? await ensureSharedRuntimes(input.userData, run);
    const bins = await installPluginEnv(input, tools, run);
    return { ok: true, dirs, bins };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

export function runtimeEnv(
  base: NodeJS.ProcessEnv,
  bins: { python?: string; node?: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  const prepend: string[] = [];
  if (bins.python) {
    env.VIRTUAL_ENV = path.resolve(path.dirname(bins.python), '..');
    prepend.push(path.dirname(bins.python));
  }
  if (bins.node) prepend.push(path.dirname(bins.node));
  if (prepend.length === 0) return env;
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const current = env[pathKey] || env.PATH || '';
  env[pathKey] = `${prepend.join(path.delimiter)}${current ? path.delimiter : ''}${current}`;
  return env;
}

function readPluginId(pluginDir: string): string {
  const manifestPath = path.join(pluginDir, 'plugin.manifest.json');
  if (!fs.existsSync(manifestPath)) return path.basename(pluginDir);
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { id?: unknown };
    return typeof raw.id === 'string' && raw.id ? raw.id : path.basename(pluginDir);
  } catch {
    return path.basename(pluginDir);
  }
}

function resolveDirs(
  userData: string | null,
  pluginDir: string,
  source: PluginSource,
  pluginId: string,
): PluginDirs {
  if (source === 'installed' && userData) {
    return {
      data: pluginDataDir(userData, pluginId),
      cache: path.join(pluginRuntimeDir(userData, pluginId), 'cache'),
    };
  }
  return {
    data: pluginDir,
    cache: path.join(pluginDir, 'cache'),
  };
}

async function prepareDevRuntime(
  input: PrepareRuntimeInput,
  dirs: PluginDirs,
  run: CommandRunner,
): Promise<PrepareRuntimeResult> {
  const bins: { python?: string; node?: string } = {};
  if (input.spec?.python) {
    const python = devPython(input.pluginDir);
    if (!python) return { ok: false, message: '开发目录里没有 .venv' };
    bins.python = python;
  }
  if (input.spec?.node) {
    const modules = path.join(input.pluginDir, 'node_modules');
    if (!fs.existsSync(modules)) return { ok: false, message: '开发目录里没有 node_modules' };
    const tools = input.tools ?? (input.userData ? await ensureSharedRuntimes(input.userData, run) : null);
    if (!tools) return { ok: false, message: '宿主没有用户数据目录' };
    bins.node = tools.node;
  }
  return { ok: true, dirs, bins };
}

async function installPluginEnv(
  input: PrepareRuntimeInput,
  tools: RuntimeTools,
  run: CommandRunner,
): Promise<{ python?: string; node?: string }> {
  const userData = input.userData;
  if (!userData || !input.spec) return {};
  const pluginId = readPluginId(input.pluginDir);
  const runtimeDir = pluginRuntimeDir(userData, pluginId);
  const envDir = path.join(runtimeDir, 'env');
  const stamp = desiredStamp(input.pluginDir, input.spec);
  const stampPath = path.join(runtimeDir, STAMP_FILE);
  const bins: { python?: string; node?: string } = {};
  if (stampMatches(stampPath, stamp, envDir, input.spec)) {
    if (input.spec.python) bins.python = venvPython(envDir);
    if (input.spec.node) {
      bins.node = tools.node;
      linkNodeModules(envDir, input.pluginDir);
    }
    return bins;
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  if (input.spec.python) {
    const requirements = requireInside(input.pluginDir, input.spec.python.requirements, 'requirements');
    fs.rmSync(envDir, { recursive: true, force: true });
    const uvEnv = toolEnv();
    const created = await run(tools.uv, ['venv', envDir, '--python', tools.python, '--clear'], {
      cwd: input.pluginDir,
      env: uvEnv,
    });
    assertRan(created, '创建 Python 环境失败');
    const lock = path.join(input.pluginDir, 'uv.lock');
    if (fs.existsSync(lock)) {
      const synced = await run(
        tools.uv,
        ['sync', '--frozen', '--no-dev', '--no-install-project'],
        {
          cwd: input.pluginDir,
          env: { ...uvEnv, UV_PROJECT_ENVIRONMENT: envDir },
        },
      );
      assertRan(synced, '安装 Python 依赖失败');
    } else {
      const installed = await run(
        tools.uv,
        ['pip', 'install', '-r', requirements, '--python', venvPython(envDir)],
        { cwd: input.pluginDir, env: uvEnv },
      );
      assertRan(installed, '安装 Python 依赖失败');
    }
    bins.python = venvPython(envDir);
  }
  if (input.spec.node) {
    const packageFile = requireInside(input.pluginDir, input.spec.node.package, 'package');
    const lock = path.join(path.dirname(packageFile), 'package-lock.json');
    if (!fs.existsSync(lock)) throw new Error('Node 插件需要 package-lock.json');
    fs.mkdirSync(envDir, { recursive: true });
    fs.copyFileSync(packageFile, path.join(envDir, 'package.json'));
    fs.copyFileSync(lock, path.join(envDir, 'package-lock.json'));
    const installed = await run(tools.npm, ['ci', '--prefix', envDir], {
      cwd: input.pluginDir,
      env: { ...process.env, npm_config_registry: npmRegistry() },
    });
    assertRan(installed, '安装 Node 依赖失败');
    linkNodeModules(envDir, input.pluginDir);
    bins.node = tools.node;
  }
  fs.writeFileSync(stampPath, JSON.stringify(stamp));
  return bins;
}

function desiredStamp(pluginDir: string, spec: PluginRuntimeSpec): InstallStamp {
  return {
    uv: UV_VERSION,
    python: PYTHON_VERSION,
    node: NODE_VERSION,
    requirementsHash: spec.python ? hashRequirements(pluginDir, spec.python.requirements) : null,
    packageHash: spec.node ? hashNodeLock(pluginDir, spec.node.package) : null,
  };
}

function hashRequirements(pluginDir: string, relative: string): string {
  const file = requireInside(pluginDir, relative, 'requirements');
  const lock = path.join(pluginDir, 'uv.lock');
  const parts = [fs.readFileSync(file)];
  if (fs.existsSync(lock)) parts.push(fs.readFileSync(lock));
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}

function hashNodeLock(pluginDir: string, relative: string): string {
  const file = requireInside(pluginDir, relative, 'package');
  const lock = path.join(path.dirname(file), 'package-lock.json');
  if (!fs.existsSync(lock)) throw new Error('Node 插件需要 package-lock.json');
  return createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
}

function stampMatches(stampPath: string, stamp: InstallStamp, envDir: string, spec: PluginRuntimeSpec): boolean {
  if (!fs.existsSync(stampPath)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(stampPath, 'utf8')) as InstallStamp;
    if (saved.uv !== stamp.uv || saved.python !== stamp.python || saved.node !== stamp.node) return false;
    if (saved.requirementsHash !== stamp.requirementsHash || saved.packageHash !== stamp.packageHash) return false;
  } catch {
    return false;
  }
  if (spec.python && !fs.existsSync(venvPython(envDir))) return false;
  if (spec.node && !fs.existsSync(path.join(envDir, 'node_modules'))) return false;
  return true;
}

function requireInside(pluginDir: string, relative: string, label: string): string {
  if (path.isAbsolute(relative) || relative.split(/[/\\]/).includes('..')) {
    throw new Error(`${label} 必须是插件目录内的相对路径`);
  }
  const file = path.resolve(pluginDir, relative);
  const fromRoot = path.relative(path.resolve(pluginDir), file);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new Error(`${label} 必须是插件目录内的相对路径`);
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`找不到 ${relative}`);
  }
  return file;
}

function linkNodeModules(envDir: string, pluginDir: string): void {
  const target = path.join(envDir, 'node_modules');
  const link = path.join(pluginDir, 'node_modules');
  if (!fs.existsSync(target)) return;
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

function toolEnv(): NodeJS.ProcessEnv {
  return { ...process.env, UV_DEFAULT_INDEX: pypiIndex() };
}

function assertRan(result: CommandResult, title: string): void {
  if (result.code === 0) return;
  const log = `${result.stderr}\n${result.stdout}`.trim();
  throw new Error(log ? `${title}\n${trimLog(log)}` : title);
}

function trimLog(log: string): string {
  const max = 4000;
  return log.length <= max ? log : log.slice(log.length - max);
}

async function ensureSharedRuntimes(userData: string, run: CommandRunner): Promise<RuntimeTools> {
  const arch = runtimeArch();
  const root = path.join(userData, 'runtimes');
  const uv = await ensureUv(root, arch);
  const python = await ensurePython(root, arch, run);
  const nodeTools = await ensureNode(root, arch, run);
  await clearQuarantine(root, run);
  return { uv, python, node: nodeTools.node, npm: nodeTools.npm };
}

async function ensureUv(root: string, arch: RuntimeArch): Promise<string> {
  const name = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const dest = path.join(root, 'uv', UV_VERSION, arch, name);
  if (fs.existsSync(dest)) return dest;
  await downloadFile(runtimeDownloadUrl('uv', arch), dest);
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  return dest;
}

async function ensurePython(root: string, arch: RuntimeArch, run: CommandRunner): Promise<string> {
  const dest = path.join(root, 'python', PYTHON_VERSION, arch);
  const existing = findBinary(dest, ['python3', 'python', 'python.exe']);
  if (existing) return existing;
  const archive = path.join(root, 'python', `${PYTHON_VERSION}-${arch}.tar.gz`);
  await downloadFile(runtimeDownloadUrl('python', arch), archive);
  fs.mkdirSync(dest, { recursive: true });
  const extracted = await run('tar', ['-xzf', archive, '-C', dest]);
  assertRan(extracted, '解压 Python 失败');
  const python = findBinary(dest, ['python3', 'python', 'python.exe']);
  if (!python) throw new Error('解压后的 Python 里没有解释器');
  return python;
}

async function ensureNode(root: string, arch: RuntimeArch, run: CommandRunner): Promise<{ node: string; npm: string }> {
  const dest = path.join(root, 'node', NODE_VERSION, arch);
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const existing = findBinary(dest, [nodeName]);
  const npm = existing ? findBinary(dest, process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm']) : null;
  if (existing && npm) return { node: existing, npm };
  const archive = path.join(root, 'node', `node-v${NODE_VERSION}-${arch}.tar.gz`);
  await downloadFile(runtimeDownloadUrl('node', arch), archive);
  fs.mkdirSync(dest, { recursive: true });
  const extracted = await run('tar', ['-xzf', archive, '-C', dest]);
  assertRan(extracted, '解压 Node 失败');
  const node = findBinary(dest, [nodeName]);
  const npmBin = findBinary(dest, process.platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm']);
  if (!node || !npmBin) throw new Error('解压后的 Node 里没有 node 或 npm');
  return { node, npm: npmBin };
}

function findBinary(root: string, names: string[]): string | null {
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) stack.push(full);
      else if (names.includes(name)) return full;
    }
  }
  return null;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载运行时失败 ${response.status} ${url}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), fs.createWriteStream(dest));
}

async function clearQuarantine(root: string, run: CommandRunner): Promise<void> {
  if (process.platform !== 'darwin') return;
  const result = await run('xattr', ['-dr', 'com.apple.quarantine', root]);
  if (result.code !== 0) {
    const log = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(log ? `无法去掉隔离属性\n${trimLog(log)}` : '无法去掉隔离属性');
  }
}
