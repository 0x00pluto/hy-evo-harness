import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readManifestFile } from './manifest.ts';
import { pluginZipUrl, versionFromTag, type PluginRelease } from './plugin-catalog.ts';

const SKIP_DIRS = new Set(['.git', '.venv', 'node_modules', 'cache', 'output', '.cursor', 'bin', '.next']);

/** 与 docs/plugin-development/ship.md 的打包排除一致，并额外丢掉 .env.* 里的本地密钥。保留 .env.example。 */
export function shouldPackRelative(relativePosix: string): boolean {
  const parts = relativePosix.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  if (parts.some((part) => SKIP_DIRS.has(part))) return false;
  const base = parts[parts.length - 1] ?? '';
  if (base === '.DS_Store' || base === '.env') return false;
  if (base.startsWith('.env.') && base !== '.env.example') return false;
  return true;
}

export function listPackPaths(root: string): string[] {
  const files: string[] = [];
  const stack = [''];
  while (stack.length > 0) {
    const relative = stack.pop() ?? '';
    const current = relative === '' ? root : path.join(root, relative);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (relative !== '' && !shouldPackRelative(relative)) continue;
      for (const name of fs.readdirSync(current)) {
        const next = relative === '' ? name : `${relative}/${name}`;
        stack.push(next);
      }
      continue;
    }
    if (stat.isFile() && shouldPackRelative(relative)) files.push(relative);
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
