import fs from 'node:fs';
import path from 'node:path';
import type { ExternalToolGuideByPlatform, ExternalToolSpec } from './types.ts';

export interface PrepareExternalToolsInput {
  tools: ExternalToolSpec[];
  platform: NodeJS.Platform;
  pathEnv: string;
  lookup?: (name: string, pathEnv: string, platform: NodeJS.Platform) => string | null;
  onProgress?: (bin: string) => void;
}

export type PrepareExternalToolsResult =
  | { ok: true; bins: Record<string, string>; dirs: string[] }
  | { ok: false; message: string; installPrompt?: string };

interface MissingCommand {
  name: string;
  guide?: string;
}

/** 复制环境后再前置目录。不改传入的对象，也不改宿主 process.env。 */
export function prependToolDirs(
  base: NodeJS.ProcessEnv,
  dirs: readonly string[],
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (dirs.length === 0) return env;
  const windows = platform === 'win32';
  const pathKey = windows ? 'Path' : 'PATH';
  const delimiter = windows ? ';' : ':';
  const current = env[pathKey] || env.PATH || '';
  const next = `${dirs.join(delimiter)}${current ? delimiter : ''}${current}`;
  env[pathKey] = next;
  if (windows) env.PATH = next;
  return env;
}

export function lookupOnPath(name: string, pathEnv: string, platform: NodeJS.Platform): string | null {
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const entry of pathEnv.split(delimiter)) {
    const dir = entry.trim();
    if (!dir) continue;
    for (const candidate of commandNames(name, platform)) {
      const full = path.join(dir, candidate);
      if (isFile(full)) return path.resolve(full);
    }
  }
  return null;
}

/** 当前系统对应的参考链接。正文不写系统名，所以这里只选出链接。 */
export function guideForPlatform(
  guide: string | ExternalToolGuideByPlatform | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  if (!guide) return undefined;
  if (typeof guide === 'string') return guide;
  if (platform === 'darwin') return guide.darwin;
  if (platform === 'win32') return guide.win32;
  return undefined;
}

export function buildInstallPrompt(missing: readonly MissingCommand[]): string {
  const lines = ['请在这台电脑上安装以下命令'];
  missing.forEach((item, index) => {
    const guide = item.guide ? ` 参考：${item.guide}` : '';
    lines.push(`${index + 1}. ${item.name}${guide}`);
  });
  lines.push('', '装好后用终端确认这些命令已经可用。');
  return lines.join('\n');
}

/**
 * 只在 PATH 里找清单声明的命令。找不到时不下载，给出一份可复制的安装说明。
 * 已经找到的名字不会出现在说明里。
 */
export async function prepareExternalTools(
  input: PrepareExternalToolsInput,
): Promise<PrepareExternalToolsResult> {
  const lookup = input.lookup ?? lookupOnPath;
  const bins: Record<string, string> = {};
  const missing: MissingCommand[] = [];
  const seen = new Set<string>();
  for (const spec of input.tools) {
    input.onProgress?.(spec.bin);
    const guide = guideForPlatform(spec.guide, input.platform);
    for (const name of [spec.bin, ...(spec.extraBins ?? [])]) {
      if (seen.has(name)) continue;
      seen.add(name);
      const found = lookup(name, input.pathEnv, input.platform);
      if (found) bins[name] = found;
      else missing.push(guide ? { name, guide } : { name });
    }
  }
  if (missing.length > 0) {
    const names = missing.map((item) => item.name).join('、');
    return { ok: false, message: `还没有 ${names}`, installPrompt: buildInstallPrompt(missing) };
  }
  return { ok: true, bins, dirs: dirsOf(bins) };
}

function commandNames(name: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return [name, `${name}.exe`, `${name}.cmd`];
  return [name];
}

function dirsOf(bins: Record<string, string>): string[] {
  const dirs: string[] = [];
  for (const file of Object.values(bins)) {
    const dir = path.dirname(file);
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
