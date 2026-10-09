import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isPluginId, readManifestFile } from './manifest.ts';
import type { ServiceRegistry } from './registry.ts';
import type { PluginSummary } from './types.ts';

const execFileAsync = promisify(execFile);
const MAX_ZIP_ENTRIES = 2000;

export function assertZipEntriesSafe(entries: string[]): void {
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error('压缩包文件过多');
  }
  for (const entry of entries) {
    if (!entry || entry.includes('\0')) {
      throw new Error('压缩包包含非法路径');
    }
    const parts = entry.split(/[/\\]/).filter((part) => part.length > 0 && part !== '.');
    if (path.isAbsolute(entry) || parts.includes('..')) {
      throw new Error(`压缩包包含越界路径: ${entry}`);
    }
  }
}

export async function installPluginZip(options: {
  registry: ServiceRegistry;
  zipFilePath: string;
  userPluginsDir: string;
}): Promise<{ installedId: string; plugins: PluginSummary[] }> {
  const zipFilePath = path.resolve(options.zipFilePath);
  if (!fs.existsSync(zipFilePath) || !fs.statSync(zipFilePath).isFile()) {
    throw new Error('找不到插件压缩包');
  }

  const entries = await listZipEntries(zipFilePath);
  assertZipEntriesSafe(entries);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-'));
  try {
    await execFileAsync('unzip', ['-q', zipFilePath, '-d', tmpDir]);
    assertExtractedTree(tmpDir);
    const pluginRoot = findPluginRoot(tmpDir);
    const manifest = readManifestFile(pluginRoot);
    await replaceInstalledPlugin(options.registry, options.userPluginsDir, manifest.id, pluginRoot);
    return { installedId: manifest.id, plugins: options.registry.getPluginList() };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function uninstallInstalledPlugin(options: {
  registry: ServiceRegistry;
  id: string;
  userPluginsDir: string;
}): Promise<PluginSummary[]> {
  const plugin = options.registry.getPlugin(options.id);
  if (!plugin || plugin.source !== 'installed') {
    throw new Error('只能卸载用户安装的插件');
  }
  const dest = resolveChildDir(options.userPluginsDir, options.id);
  await options.registry.unloadPlugin(options.id);
  fs.rmSync(dest, { recursive: true, force: true });
  // 目录已经删掉才动配置。删除失败时上面的 rmSync 会抛出，配置块留着。
  options.registry.deletePluginSettings(options.id);
  return options.registry.getPluginList();
}

async function listZipEntries(zipFilePath: string): Promise<string[]> {
  try {
    const result = await execFileAsync('unzip', ['-Z1', zipFilePath], { maxBuffer: 10 * 1024 * 1024 });
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT')) {
      throw new Error('系统未找到 unzip，无法安装插件');
    }
    throw new Error('无法读取插件压缩包');
  }
}

function findPluginRoot(extractedDir: string): string {
  if (fs.existsSync(path.join(extractedDir, 'plugin.manifest.json'))) {
    return extractedDir;
  }
  const children = fs.readdirSync(extractedDir).filter((name) => {
    if (name === '__MACOSX' || name.startsWith('.')) return false;
    return fs.statSync(path.join(extractedDir, name)).isDirectory();
  });
  const withManifest = children.filter((name) =>
    fs.existsSync(path.join(extractedDir, name, 'plugin.manifest.json')),
  );
  if (withManifest.length === 1) {
    return path.join(extractedDir, withManifest[0] as string);
  }
  throw new Error('压缩包内未找到唯一的 plugin.manifest.json');
}

function assertExtractedTree(root: string): void {
  const realRoot = fs.realpathSync(root);
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const stat = fs.lstatSync(current);
    const realCurrent = fs.realpathSync(current);
    const relative = path.relative(realRoot, realCurrent);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('压缩包包含越界路径');
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      for (const name of fs.readdirSync(current)) {
        stack.push(path.join(current, name));
      }
    }
  }
}

// 覆盖安装只换插件目录。用户配置在 userData/plugin-settings.json，不随目录一起删。
async function replaceInstalledPlugin(
  registry: ServiceRegistry,
  userPluginsDir: string,
  id: string,
  pluginRoot: string,
): Promise<void> {
  const existing = registry.getPlugin(id);
  if (existing && existing.source !== 'installed') {
    const from = existing.source === 'dev' ? '开发路径' : '内置目录';
    throw new Error(`插件 ${id} 已由${from}提供，不能覆盖安装`);
  }
  if (existing) {
    await registry.unloadPlugin(id);
  }

  fs.mkdirSync(userPluginsDir, { recursive: true });
  const dest = resolveChildDir(userPluginsDir, id);
  const backup = path.join(userPluginsDir, `.${id}.bak`);
  fs.rmSync(backup, { recursive: true, force: true });
  if (fs.existsSync(dest)) {
    fs.renameSync(dest, backup);
  }

  try {
    fs.cpSync(pluginRoot, dest, { recursive: true });
    await registry.loadPluginFromDirectory(dest, 'installed');
    fs.rmSync(backup, { recursive: true, force: true });
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    if (fs.existsSync(backup)) {
      fs.renameSync(backup, dest);
      try {
        await registry.loadPluginFromDirectory(dest, 'installed');
      } catch (restoreErr) {
        registry.logger.error(
          `回滚插件 ${id} 失败: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
        );
      }
    }
    throw err;
  }
}

function resolveChildDir(parentDir: string, id: string): string {
  if (!isPluginId(id)) {
    throw new Error('插件 id 无效');
  }
  const root = path.resolve(parentDir);
  const dest = path.resolve(root, id);
  const relative = path.relative(root, dest);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error('插件目录越界');
  }
  return dest;
}
