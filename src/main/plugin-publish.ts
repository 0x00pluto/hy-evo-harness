import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_PUBLISH_FILE = 'dex-buddy-plugin-pack.json';

/** 与 Dex Buddy 安装包的三端一致。工作流矩阵要和这里保持相同。 */
export const PLUGIN_PACK_TARGETS = [
  { runner: 'macos-latest', os: 'darwin' },
  { runner: 'windows-latest', os: 'win32' },
  { runner: 'ubuntu-latest', os: 'linux' },
] as const;

export type PluginPublish = {
  pack: string;
};

/** 没有这份文件表示不编译，直接打包检出的树。有文件时 pack 必须是仓库内的脚本。runners 若仍写着则忽略。 */
export function loadPluginPublish(root: string): PluginPublish | null {
  const file = path.join(root, PLUGIN_PUBLISH_FILE);
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${PLUGIN_PUBLISH_FILE} 不是合法 JSON：${message}`);
  }
  const parsed = parsePluginPublish(raw);
  const script = path.resolve(root, parsed.pack);
  const relative = path.relative(root, script);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('pack 必须在插件仓库内');
  }
  if (!fs.existsSync(script) || !fs.statSync(script).isFile()) {
    throw new Error(`找不到打包脚本 ${parsed.pack}`);
  }
  return parsed;
}

export function parsePluginPublish(raw: unknown): PluginPublish {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${PLUGIN_PUBLISH_FILE} 必须是对象`);
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'pack' && key !== 'runners') {
      throw new Error(`${PLUGIN_PUBLISH_FILE} 含未知字段 ${key}`);
    }
  }
  if (typeof record.pack !== 'string') {
    throw new Error('pack 必须是相对路径');
  }
  return { pack: normalizePackPath(record.pack) };
}

function normalizePackPath(pack: string): string {
  if (!/^[A-Za-z0-9_./-]+$/.test(pack) || pack.startsWith('/') || path.win32.isAbsolute(pack)) {
    throw new Error('pack 必须是仓库内的相对路径');
  }
  const parts = pack.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('pack 不能包含 ..');
  }
  return parts.join('/');
}
