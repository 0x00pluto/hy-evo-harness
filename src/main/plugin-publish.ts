import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_PUBLISH_FILE = 'dex-buddy.publish.json';

export const ALLOWED_PUBLISH_RUNNERS = ['ubuntu-latest', 'macos-14', 'windows-latest'] as const;

export type PluginPublish = {
  pack: string;
  runners: string[];
};

/** 没有这份文件表示不编译，直接打包检出的树。有文件时 pack 必须是仓库内的脚本，runners 不能为空。 */
export function loadPluginPublish(root: string): PluginPublish | null {
  const file = path.join(root, PLUGIN_PUBLISH_FILE);
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`dex-buddy.publish.json 不是合法 JSON：${message}`);
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
    throw new Error('dex-buddy.publish.json 必须是对象');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'pack' && key !== 'runners') {
      throw new Error(`dex-buddy.publish.json 含未知字段 ${key}`);
    }
  }
  if (typeof record.pack !== 'string') {
    throw new Error('pack 必须是相对路径');
  }
  const pack = normalizePackPath(record.pack);
  if (!Array.isArray(record.runners) || record.runners.length === 0) {
    throw new Error('runners 不能为空');
  }
  const runners: string[] = [];
  for (const runner of record.runners) {
    if (typeof runner !== 'string' || !isAllowedRunner(runner)) {
      throw new Error(`runners 只接受 ${ALLOWED_PUBLISH_RUNNERS.join('、')}`);
    }
    if (runners.includes(runner)) {
      throw new Error(`runners 重复：${runner}`);
    }
    runners.push(runner);
  }
  return { pack, runners };
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

function isAllowedRunner(runner: string): runner is (typeof ALLOWED_PUBLISH_RUNNERS)[number] {
  return (ALLOWED_PUBLISH_RUNNERS as readonly string[]).includes(runner);
}
