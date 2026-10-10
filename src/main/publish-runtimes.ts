import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import {
  NODE_VERSION,
  PYTHON_VERSION,
  RUNTIME_ARCHES,
  UV_VERSION,
  runtimeDownloadUrl,
  runtimeQiniuKey,
  type RuntimeArch,
  type RuntimeKind,
} from './plugin-runtime.ts';

export type UploadAction = 'upload' | 'skip' | 'overwrite';

export type RemoteStat =
  | { status: 'missing' }
  | { status: 'present'; hash: string }
  | { status: 'unknown'; detail: string };

export interface UploadDecision {
  action: UploadAction;
  /** 分不清「没有」和「比较失败」时覆盖上传，避免发版卡死。 */
  fallback: boolean;
}

const UV_TRIPLE: Record<RuntimeArch, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

const PYTHON_TRIPLE: Record<RuntimeArch, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

export function uvAssetName(arch: RuntimeArch): string {
  const ext = arch === 'win32-x64' ? 'zip' : 'tar.gz';
  return `uv-${UV_TRIPLE[arch]}.${ext}`;
}

export function uvDownloadCandidates(arch: RuntimeArch): string[] {
  const name = uvAssetName(arch);
  const tags = UV_VERSION.startsWith('v') ? [UV_VERSION] : [UV_VERSION, `v${UV_VERSION}`];
  return tags.map((tag) => `https://github.com/astral-sh/uv/releases/download/${tag}/${name}`);
}

export function nodeUpstreamName(arch: RuntimeArch): string {
  if (arch === 'win32-x64') return `node-v${NODE_VERSION}-win-x64.zip`;
  return `node-v${NODE_VERSION}-${arch}.tar.gz`;
}

export function nodeUpstreamUrl(arch: RuntimeArch): string {
  return `https://nodejs.org/dist/v${NODE_VERSION}/${nodeUpstreamName(arch)}`;
}

export function pythonTriple(arch: RuntimeArch): string {
  return PYTHON_TRIPLE[arch];
}

/** 多个日期时用最新的 install_only。stripped 和其他架构不算。 */
export function pickPythonAsset(names: readonly string[], arch: RuntimeArch): string | null {
  const pattern = new RegExp(
    `^cpython-${escapeRegExp(PYTHON_VERSION)}\\+(\\d{8})-${escapeRegExp(pythonTriple(arch))}-install_only\\.tar\\.gz$`,
  );
  const matches = names.flatMap((name) => {
    const found = pattern.exec(name);
    return found?.[1] ? [{ name, date: found[1] }] : [];
  });
  matches.sort((left, right) => right.date.localeCompare(left.date));
  return matches[0]?.name ?? null;
}

export function parseQshellStat(code: number, stdout: string, stderr: string): RemoteStat {
  if (code === 0) {
    const hash = /^(?:Etag|Hash):\s*(\S+)/m.exec(stdout)?.[1];
    if (hash) return { status: 'present', hash };
  }
  const text = `${stdout}\n${stderr}`;
  if (/\bno such file\b|\b612\b/.test(text)) return { status: 'missing' };
  const detail = text.trim() || `qshell stat 退出码 ${code}`;
  return { status: 'unknown', detail };
}

export function parseQetag(code: number, stdout: string): string | null {
  if (code !== 0) return null;
  const token = stdout.trim().split(/\s+/)[0];
  return token || null;
}

export function decideUpload(remote: RemoteStat, localHash: string | null): UploadDecision {
  if (remote.status === 'missing') return { action: 'upload', fallback: false };
  if (remote.status === 'unknown' || !localHash) return { action: 'overwrite', fallback: true };
  if (remote.hash === localHash) return { action: 'skip', fallback: false };
  return { action: 'overwrite', fallback: false };
}

export async function publishRuntimes(): Promise<void> {
  const bucket = requiredEnv('QINIU_BUCKET');
  const accessKey = requiredEnv('QINIU_ACCESS_KEY');
  const secretKey = requiredEnv('QINIU_SECRET_KEY');
  const account = capture('qshell', ['account', '--overwrite', '--', accessKey, secretKey, 'dex-buddy']);
  if (account.code !== 0) {
    throw new Error(`qshell 登录失败\n${account.stderr}\n${account.stdout}`);
  }

  const refreshed: string[] = [];
  for (const kind of ['uv', 'python', 'node'] as const) {
    for (const arch of RUNTIME_ARCHES) {
      const key = runtimeQiniuKey(kind, arch);
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-runtime-'));
      try {
        const file = await materialize(kind, arch, work);
        const qetag = capture('qshell', ['qetag', file]);
        const localHash = parseQetag(qetag.code, qetag.stdout);
        const stat = capture('qshell', ['stat', bucket, key]);
        const remote = parseQshellStat(stat.code, stat.stdout, stat.stderr);
        const decision = decideUpload(remote, localHash);
        if (decision.action === 'skip') {
          console.log(`跳过 ${key}，七牛上已是同一份`);
          continue;
        }
        if (decision.fallback) {
          const detail = remote.status === 'unknown' ? remote.detail : (qetag.stderr || qetag.stdout || 'qetag 失败');
          console.log(`无法比较 ${key}，退回覆盖上传：${detail.trim()}`);
        } else if (decision.action === 'overwrite') {
          console.log(`覆盖 ${key}，内容和上游不同`);
        } else {
          console.log(`上传 ${key}`);
        }
        const put = capture('qshell', ['rput', '--overwrite', bucket, key, file]);
        if (put.code !== 0) {
          throw new Error(`上传失败 ${key}\n${put.stderr}\n${put.stdout}`);
        }
        refreshed.push(runtimeDownloadUrl(kind, arch));
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
  }

  if (refreshed.length === 0) {
    console.log('没有新文件，不刷新 CDN');
    return;
  }
  const list = path.join(os.tmpdir(), `qiniu-runtime-refresh-${process.pid}.txt`);
  fs.writeFileSync(list, `${refreshed.join('\n')}\n`);
  const refresh = capture('qshell', ['cdnrefresh', '-i', list]);
  if (refresh.code !== 0) {
    throw new Error(`刷新 CDN 失败\n${refresh.stderr}\n${refresh.stdout}`);
  }
  console.log(`已刷新 ${refreshed.length} 条 CDN`);
}

async function materialize(kind: RuntimeKind, arch: RuntimeArch, work: string): Promise<string> {
  if (kind === 'uv') return materializeUv(arch, work);
  if (kind === 'python') return materializePython(arch, work);
  return materializeNode(arch, work);
}

async function materializeUv(arch: RuntimeArch, work: string): Promise<string> {
  const archive = path.join(work, uvAssetName(arch));
  await downloadFirst(uvDownloadCandidates(arch), archive);
  const extracted = path.join(work, 'extracted');
  fs.mkdirSync(extracted);
  extractArchive(archive, extracted);
  const binary = findNamed(extracted, arch === 'win32-x64' ? 'uv.exe' : 'uv');
  if (!binary) throw new Error(`uv 包里没有可执行文件 ${uvAssetName(arch)}`);
  return binary;
}

async function materializePython(arch: RuntimeArch, work: string): Promise<string> {
  const asset = await findPythonAsset(arch);
  const dest = path.join(work, path.basename(runtimeQiniuKey('python', arch)));
  console.log(`下载 ${asset.name}`);
  await downloadFirst([asset.url], dest);
  return dest;
}

async function materializeNode(arch: RuntimeArch, work: string): Promise<string> {
  const source = path.join(work, nodeUpstreamName(arch));
  await downloadFirst([nodeUpstreamUrl(arch)], source);
  if (arch !== 'win32-x64') return source;
  // 官方 Windows 包是 zip，客户端只用 tar 解。打成 tar.gz，文件名里的平台仍是 win32-x64。
  const extracted = path.join(work, 'extracted');
  fs.mkdirSync(extracted);
  extractArchive(source, extracted);
  const packed = path.join(work, path.basename(runtimeQiniuKey('node', arch)));
  run('tar', ['-czf', packed, '-C', extracted, '.']);
  return packed;
}

async function findPythonAsset(arch: RuntimeArch): Promise<{ name: string; url: string }> {
  for (let page = 1; page <= 5; page += 1) {
    const releases = await githubJson(
      `https://api.github.com/repos/astral-sh/python-build-standalone/releases?per_page=20&page=${page}`,
    );
    if (!Array.isArray(releases) || releases.length === 0) break;
    const assets = releases.flatMap((release) => {
      const list = (release as { assets?: { name?: string; browser_download_url?: string }[] }).assets ?? [];
      return list.flatMap((asset) => (
        asset.name && asset.browser_download_url
          ? [{ name: asset.name, url: asset.browser_download_url }]
          : []
      ));
    });
    const name = pickPythonAsset(assets.map((asset) => asset.name), arch);
    const found = assets.find((asset) => asset.name === name);
    if (found) return found;
  }
  throw new Error(`python-build-standalone 没有 ${PYTHON_VERSION} ${pythonTriple(arch)} 的 install_only`);
}

async function githubJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dex-buddy-publish-runtimes',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub ${response.status} ${url}`);
  return response.json();
}

async function downloadFirst(urls: string[], dest: string): Promise<void> {
  let last = '';
  for (const url of urls) {
    const response = await fetch(url);
    if (response.status === 404) {
      last = url;
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`下载失败 ${response.status} ${url}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      fs.createWriteStream(dest),
    );
    return;
  }
  throw new Error(`上游没有这个文件，最后尝试 ${last}`);
}

function extractArchive(archive: string, dest: string): void {
  if (archive.endsWith('.zip')) {
    run('python3', ['-m', 'zipfile', '-e', archive, dest]);
    return;
  }
  run('tar', ['-xzf', archive, '-C', dest]);
}

function findNamed(root: string, name: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

function run(command: string, args: string[]): void {
  const result = capture(command, args);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败\n${result.stderr}\n${result.stdout}`);
  }
}

function capture(command: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
