import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packPluginRelease } from '../src/main/plugin-pack.ts';
import {
  buildPluginCatalog,
  parsePluginRelease,
  PLUGIN_CDN_BASE,
  releaseKeysFromList,
  type PluginRelease,
} from '../src/main/plugin-catalog.ts';
import { assertNoBinaryPack } from '../src/main/plugin-publish.ts';
import {
  githubRemoteUrl,
  parsePluginRepos,
  pluginZipObjectKey,
  syncPluginCatalog,
  tagsFromLsRemote,
  type PreparedPlugin,
} from '../src/main/plugin-catalog-sync.ts';
import { parseQshellStat } from '../src/main/publish-runtimes.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bucket = requiredEnv('QINIU_BUCKET');
const accessKey = requiredEnv('QINIU_ACCESS_KEY');
const secretKey = requiredEnv('QINIU_SECRET_KEY');
const token = checkoutToken();

const account = capture('qshell', ['account', '--overwrite', '--', accessKey, secretKey, 'dex-buddy']);
if (account.code !== 0) {
  throw new Error(`qshell 登录失败\n${account.stderr}\n${account.stdout}`);
}

const workDirs = new Map<string, string>();
const repositories = parsePluginRepos(fs.readFileSync(path.join(root, '.github/plugin-repos.json'), 'utf8'));
const report = await syncPluginCatalog(repositories, {
  listTags,
  prepare,
  hasZip,
  upload,
  discard,
  rebuild,
});

for (const plugin of report.published) {
  console.log(`发布 ${plugin.repository} ${plugin.tag} -> ${plugin.id} ${plugin.version}`);
}
for (const plugin of report.skipped) {
  console.log(`跳过 ${plugin.repository} ${plugin.tag}，七牛上已有 ${plugin.id} ${plugin.version}`);
}
for (const failure of report.failures) {
  console.error(`失败 ${failure.repository}：${failure.message}`);
}
if (report.failures.length > 0) process.exitCode = 1;

async function listTags(repository: string): Promise<string[]> {
  const listed = git(['ls-remote', '--tags', githubRemoteUrl(repository, token)]);
  if (listed.code !== 0) {
    const hint = token ? '' : '\n私有仓库需要在本仓设置 PLUGIN_CHECKOUT_TOKEN';
    throw new Error(`读取 tag 失败 ${repository}\n${redact(listed.stderr || listed.stdout)}${hint}`);
  }
  return tagsFromLsRemote(listed.stdout);
}

async function prepare(repository: string, tag: string): Promise<PreparedPlugin> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-plugin-sync-'));
  const sourceDir = path.join(work, 'source');
  const cloned = git(['clone', '--depth', '1', '--branch', tag, githubRemoteUrl(repository, token), sourceDir]);
  if (cloned.code !== 0) {
    fs.rmSync(work, { recursive: true, force: true });
    const hint = token ? '' : '\n私有仓库需要在本仓设置 PLUGIN_CHECKOUT_TOKEN';
    throw new Error(`检出 ${repository} ${tag} 失败\n${redact(cloned.stderr || cloned.stdout)}${hint}`);
  }
  try {
    assertNoBinaryPack(sourceDir);
    const packed = await packPluginRelease({
      sourceDir,
      tag,
      outDir: path.join(work, 'release'),
    });
    workDirs.set(packed.zipPath, work);
    return {
      repository,
      tag,
      id: packed.release.id,
      version: packed.release.version,
      zipPath: packed.zipPath,
      jsonPath: packed.jsonPath,
      iconPath: packed.iconPath,
      iconUrl: packed.release.iconUrl,
    };
  } catch (error) {
    fs.rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

async function hasZip(id: string, version: string): Promise<boolean> {
  const key = pluginZipObjectKey(id, version);
  const stat = capture('qshell', ['stat', bucket, key]);
  const remote = parseQshellStat(stat.code, stat.stdout, stat.stderr);
  if (remote.status === 'present') return true;
  if (remote.status === 'missing') return false;
  throw new Error(`无法确认 ${key} 是否已发布：${remote.detail}`);
}

async function upload(plugin: PreparedPlugin): Promise<void> {
  const prefix = `dex-buddy/plugins/${plugin.id}/${plugin.version}`;
  // zip 是「已经发布」的标记。先传说明，有图标再传图标，最后传 zip。中途失败时下次还会重试。
  put(`${prefix}.json`, plugin.jsonPath);
  if (plugin.iconPath && plugin.iconUrl) {
    put(new URL(plugin.iconUrl).pathname.replace(/^\//, ''), plugin.iconPath);
  }
  put(`${prefix}.zip`, plugin.zipPath);
}

async function discard(plugin: PreparedPlugin): Promise<void> {
  const work = workDirs.get(plugin.zipPath);
  if (work) fs.rmSync(work, { recursive: true, force: true });
}

async function rebuild(published: PreparedPlugin[]): Promise<void> {
  const versionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-plugin-versions-'));
  const listPath = path.join(os.tmpdir(), `plugin-keys-${process.pid}.txt`);
  const listed = capture('qshell', ['listbucket', '--prefix', 'dex-buddy/plugins/', bucket, '-o', listPath]);
  if (listed.code !== 0 && !fs.existsSync(listPath)) {
    throw new Error(`列举插件目录失败\n${listed.stderr}\n${listed.stdout}`);
  }
  const keys = releaseKeysFromList(fs.existsSync(listPath) ? fs.readFileSync(listPath, 'utf8') : '');
  const releases: PluginRelease[] = [];
  for (const key of keys) {
    const dest = path.join(versionsDir, key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const got = capture('qshell', ['get', bucket, key, '-o', dest]);
    if (got.code !== 0) throw new Error(`下载版本说明失败 ${key}\n${got.stderr}\n${got.stdout}`);
    const release = parsePluginRelease(JSON.parse(fs.readFileSync(dest, 'utf8')));
    if (release) releases.push(release);
  }
  const catalog = buildPluginCatalog(releases, new Date().toISOString());
  const indexPath = path.join(os.tmpdir(), `plugin-index-${process.pid}.json`);
  fs.writeFileSync(indexPath, `${JSON.stringify(catalog, null, 2)}\n`);
  put('dex-buddy/plugins/index.json', indexPath);
  const urls = [
    ...published.flatMap((plugin) => [
      `${PLUGIN_CDN_BASE}/${plugin.id}/${plugin.version}.zip`,
      `${PLUGIN_CDN_BASE}/${plugin.id}/${plugin.version}.json`,
      ...(plugin.iconUrl ? [plugin.iconUrl] : []),
    ]),
    `${PLUGIN_CDN_BASE}/index.json`,
  ];
  const refreshList = path.join(os.tmpdir(), `plugin-refresh-${process.pid}.txt`);
  fs.writeFileSync(refreshList, `${urls.join('\n')}\n`);
  const refresh = capture('qshell', ['cdnrefresh', '-i', refreshList]);
  if (refresh.code !== 0) {
    throw new Error(`刷新 CDN 失败\n${refresh.stderr}\n${refresh.stdout}`);
  }
  console.log(`已合成目录，刷新 ${urls.length} 条 CDN`);
}

function put(key: string, filePath: string): void {
  const result = capture('qshell', ['rput', '--overwrite', bucket, key, filePath]);
  if (result.code !== 0) {
    throw new Error(`上传失败 ${key}\n${result.stderr}\n${result.stdout}`);
  }
}

function git(args: string[]): { code: number; stdout: string; stderr: string } {
  // actions/checkout 会把本仓 GITHUB_TOKEN 写成 github.com 的 extraheader。
  // 那个令牌不能用来检出别的仓库，带上它时公开仓库也会要求输入用户名。
  const command = ['-c', 'credential.helper=', '-c', 'http.https://github.com/.extraheader=', ...args];
  return capture('git', command, 8 * 1024 * 1024, { ...process.env, GIT_TERMINAL_PROMPT: '0' });
}

function capture(
  command: string,
  args: string[],
  maxBuffer = 1024 * 1024,
  env?: NodeJS.ProcessEnv,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer, env });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? `${result.stderr ?? ''}\n${result.error.message}` : (result.stderr ?? ''),
  };
}

function checkoutToken(): string | undefined {
  const dedicated = process.env.PLUGIN_CHECKOUT_TOKEN?.trim();
  return dedicated || undefined;
}

function redact(text: string): string {
  if (!token) return text;
  return text.split(token).join('***').split(encodeURIComponent(token)).join('***');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}
