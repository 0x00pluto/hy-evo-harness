import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readManifestFile } from './manifest.ts';
import { pluginZipUrl, versionFromTag, type PluginRelease } from './plugin-catalog.ts';

const SKIP_DIRS = new Set(['.git', '.venv', 'node_modules', 'cache', 'output', 'temp', '.cursor', 'bin', '.next']);

export const PLUGIN_PACK_FILE = 'dex-buddy-plugin.pack';
export const PLUGIN_PACK_IGNORE_FILE = 'dex-buddy-plugin.ignore';

export interface PackPattern {
  directory: boolean;
  segments: string[];
}

/** 与 docs/plugin-development/pack.md 的宿主排除一致。插件清单不能把这些路径加回来。 */
export function shouldPackRelative(relativePosix: string): boolean {
  const parts = relativePosix.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  if (parts.some((part) => SKIP_DIRS.has(part))) return false;
  const base = parts[parts.length - 1] ?? '';
  if (base === '.DS_Store' || base === '.env') return false;
  if (base.startsWith('.env.') && base !== '.env.example') return false;
  return true;
}

export function parsePackPatterns(text: string, fileName: string): PackPattern[] {
  const patterns: PackPattern[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const pattern = parsePackLine(lines[index] ?? '', index + 1, fileName);
    if (pattern) patterns.push(pattern);
  }
  return patterns;
}

export function matchesPackPattern(relativePosix: string, pattern: PackPattern): boolean {
  const parts = relativePosix.split('/').filter((part) => part.length > 0);
  if (pattern.directory) {
    if (parts.length < pattern.segments.length) return false;
  } else if (parts.length !== pattern.segments.length) {
    return false;
  }
  return pattern.segments.every((segment, index) => segmentMatches(parts[index] ?? '', segment));
}

export function listPackPaths(root: string): string[] {
  const pack = readPackPatterns(root, PLUGIN_PACK_FILE);
  const ignore = readPackPatterns(root, PLUGIN_PACK_IGNORE_FILE) ?? [];
  const files: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const relative = stack.pop() ?? '';
    const current = relative === '' ? root : path.join(root, relative);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!shouldDescend(relative, pack, ignore)) continue;
      for (const name of fs.readdirSync(current)) {
        const next = relative === '' ? name : `${relative}/${name}`;
        stack.push(next);
      }
      continue;
    }
    if (stat.isFile() && shouldIncludeFile(relative, pack, ignore)) files.push(relative);
  }
  files.sort();
  return files;
}

export async function packPluginRelease(options: {
  sourceDir: string;
  tag: string;
  outDir: string;
}): Promise<{ release: PluginRelease; zipPath: string; jsonPath: string }> {
  const version = versionFromTag(options.tag);
  const manifest = readManifestFile(options.sourceDir);
  if (manifest.version !== version) {
    throw new Error(`清单版本 ${manifest.version} 与 tag ${options.tag} 不一致`);
  }
  const files = listPackPaths(options.sourceDir);
  if (!files.includes('plugin.manifest.json')) {
    throw new Error('打包结果里没有 plugin.manifest.json');
  }
  fs.mkdirSync(options.outDir, { recursive: true });
  const zipPath = path.join(options.outDir, `${manifest.id}-${version}.zip`);
  const jsonPath = path.join(options.outDir, `${manifest.id}-${version}.json`);
  fs.rmSync(zipPath, { force: true });
  await runZip(options.sourceDir, zipPath, files);
  const sha256 = sha256File(zipPath);
  const release: PluginRelease = {
    id: manifest.id,
    displayName: manifest.displayName,
    version,
    downloadUrl: pluginZipUrl(manifest.id, version),
    sha256,
  };
  if (manifest.description) release.description = manifest.description;
  fs.writeFileSync(jsonPath, `${JSON.stringify(release, null, 2)}\n`);
  return { release, zipPath, jsonPath };
}

export function sha256File(filePath: string): string {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readPackPatterns(root: string, fileName: string): PackPattern[] | null {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${fileName} 必须是文件`);
  }
  return parsePackPatterns(fs.readFileSync(filePath, 'utf8'), fileName);
}

function parsePackLine(line: string, lineNumber: number, fileName: string): PackPattern | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  if (
    trimmed.startsWith('!')
    || trimmed.startsWith('/')
    || trimmed.includes('\\')
    || trimmed.includes('**')
  ) {
    throw new Error(`${fileName} 第 ${lineNumber} 行无效`);
  }
  const directory = trimmed.endsWith('/');
  const body = directory ? trimmed.slice(0, -1) : trimmed;
  if (body === '') throw new Error(`${fileName} 第 ${lineNumber} 行无效`);
  const segments = body.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${fileName} 第 ${lineNumber} 行无效`);
  }
  return { directory, segments };
}

function shouldIncludeFile(relative: string, pack: PackPattern[] | null, ignore: readonly PackPattern[]): boolean {
  if (!shouldPackRelative(relative)) return false;
  if (pack && !pack.some((pattern) => matchesPackPattern(relative, pattern))) return false;
  return !ignore.some((pattern) => matchesPackPattern(relative, pattern));
}

function shouldDescend(relative: string, pack: PackPattern[] | null, ignore: readonly PackPattern[]): boolean {
  if (relative === '') return true;
  if (!shouldPackRelative(relative)) return false;
  if (ignore.some((pattern) => pattern.directory && matchesPackPattern(relative, pattern))) return false;
  if (!pack) return true;
  return pack.some((pattern) => patternCouldInclude(relative, pattern));
}

function patternCouldInclude(relative: string, pattern: PackPattern): boolean {
  const parts = relative.split('/').filter((part) => part.length > 0);
  const limit = Math.min(parts.length, pattern.segments.length);
  for (let index = 0; index < limit; index += 1) {
    if (!segmentMatches(parts[index] ?? '', pattern.segments[index] ?? '')) return false;
  }
  if (parts.length <= pattern.segments.length) return true;
  return pattern.directory;
}

function segmentMatches(name: string, pattern: string): boolean {
  if (!pattern.includes('*')) return name === pattern;
  const expression = `^${pattern.split('*').map(escapeRegExp).join('[^/]*')}$`;
  return new RegExp(expression).test(name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runZip(cwd: string, zipPath: string, files: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-q', zipPath, '-@'], { cwd });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `zip 退出 ${code}`));
    });
    child.stdin.end(`${files.join('\n')}\n`);
  });
}
