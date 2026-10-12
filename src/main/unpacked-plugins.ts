import fs from 'node:fs';
import path from 'node:path';
import { canonicalDirectory, instanceIdForPath } from './instance-id.ts';
import { readManifestFile } from './manifest.ts';
import { pluginDataDir, pluginRuntimeDir } from './plugin-runtime.ts';

export interface LocalRoot {
  sourcePath: string;
  instanceId: string;
  manifestId: string;
}

export type InspectDirectoryResult =
  | { ok: true; registeredPath: string; roots: LocalRoot[] }
  | { ok: false; message: string };

export function unpackedPluginsFile(userData: string): string {
  return path.join(userData, 'unpacked-plugins.json');
}

export function previewDir(userData: string, instanceId: string): string {
  return path.join(userData, 'plugin-preview', instanceId);
}

/** 移除本地实例时只碰这些目录。调用方另删设置里的实例 id，不删源码。 */
export function instanceDataPaths(userData: string, instanceId: string): {
  runtimeDir: string;
  dataDir: string;
  previewDir: string;
} {
  return {
    runtimeDir: pluginRuntimeDir(userData, instanceId),
    dataDir: pluginDataDir(userData, instanceId),
    previewDir: previewDir(userData, instanceId),
  };
}

export function readUnpackedPaths(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const paths = (parsed as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];
  const result: string[] = [];
  for (const item of paths) {
    if (typeof item !== 'string' || item.trim() === '') continue;
    result.push(item);
  }
  return result;
}

export function writeUnpackedPaths(filePath: string, paths: readonly string[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ paths }, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

/**
 * 根上有清单就只认这一份。否则每个含清单的子目录是一个插件根。
 * 父目录本身不成为插件。
 */
export function discoverPluginRoots(rootDir: string): string[] {
  let root: string;
  try {
    root = canonicalDirectory(rootDir);
  } catch {
    return [];
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  if (fs.existsSync(path.join(root, 'plugin.manifest.json'))) return [root];

  const found: string[] = [];
  for (const folder of fs.readdirSync(root)) {
    if (folder.startsWith('.') || folder === '__MACOSX') continue;
    const pluginDir = path.join(root, folder);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(pluginDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!fs.existsSync(path.join(pluginDir, 'plugin.manifest.json'))) continue;
    try {
      found.push(canonicalDirectory(pluginDir));
    } catch {
      continue;
    }
  }
  return found;
}

/**
 * 选择目录时整次校验。任一清单不合法，或实例 id 撞上已加载插件的清单 id，就不登记。
 */
export function inspectDirectory(dir: string, occupiedManifestIds: ReadonlySet<string>): InspectDirectoryResult {
  let registeredPath: string;
  try {
    registeredPath = canonicalDirectory(dir);
  } catch {
    return { ok: false, message: '找不到这个目录' };
  }
  if (!fs.statSync(registeredPath).isDirectory()) {
    return { ok: false, message: '请选择文件夹' };
  }
  const roots = discoverPluginRoots(registeredPath);
  if (roots.length === 0) {
    return { ok: false, message: '这个目录里没有 plugin.manifest.json' };
  }
  const parsed: LocalRoot[] = [];
  for (const sourcePath of roots) {
    let manifestId: string;
    try {
      manifestId = readManifestFile(sourcePath).id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
    const instanceId = instanceIdForPath(sourcePath);
    if (occupiedManifestIds.has(instanceId)) {
      return { ok: false, message: `实例 id 与已加载插件 ${instanceId} 相同，已拒绝` };
    }
    parsed.push({ sourcePath, instanceId, manifestId });
  }
  return { ok: true, registeredPath, roots: parsed };
}

/**
 * 父目录登记了多个插件时，移除其中一个就把剩下的兄弟改写成各自的插件根。
 * 登记的就是这个插件根，或它是最后一个，则删掉这条路径。
 */
export function pathsAfterRemoval(
  registeredPaths: readonly string[],
  registeredPath: string,
  removedSource: string,
  remainingSiblingSources: readonly string[],
): string[] {
  const next = registeredPaths.filter((item) => item !== registeredPath && item !== removedSource);
  if (registeredPath === removedSource || remainingSiblingSources.length === 0) return next;
  for (const sibling of remainingSiblingSources) {
    if (!next.includes(sibling)) next.push(sibling);
  }
  return next;
}
