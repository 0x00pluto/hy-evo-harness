import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  objectKeysFromList,
  parseReleaseKeep,
  planReleaseRetention,
  RELEASE_OBJECT_PREFIX,
} from '../src/main/qiniu-release-retention.ts';

const bucket = requiredEnv('QINIU_BUCKET');
const accessKey = requiredEnv('QINIU_ACCESS_KEY');
const secretKey = requiredEnv('QINIU_SECRET_KEY');
const protectVersion = releaseVersion();
const keep = parseReleaseKeep(process.env.QINIU_RELEASE_KEEP);

const account = capture('qshell', ['account', '--overwrite', '--', accessKey, secretKey, 'dex-buddy']);
if (account.code !== 0) {
  throw new Error(`qshell 登录失败\n${account.stderr}\n${account.stdout}`);
}

const listPath = path.join(os.tmpdir(), `qiniu-release-keys-${process.pid}.txt`);
fs.rmSync(listPath, { force: true });
const listed = capture('qshell', [
  'listbucket2',
  '--prefix',
  RELEASE_OBJECT_PREFIX,
  bucket,
  '-o',
  listPath,
]);
if (listed.code !== 0 || !fs.existsSync(listPath)) {
  throw new Error(`列举 ${RELEASE_OBJECT_PREFIX} 失败，不删除任何对象\n${listed.stderr}\n${listed.stdout}`);
}

const keys = objectKeysFromList(fs.readFileSync(listPath, 'utf8'));
const plan = planReleaseRetention(keys, { keep, protectVersion });

console.log(`保留 ${plan.keepVersions.length} 个版本：${plan.keepVersions.join(', ') || '(无)'}`);
console.log(`保护本版 ${protectVersion}；计划删除 ${plan.deleteKeys.length} 个对象`);

if (plan.deleteKeys.length === 0) {
  console.log('没有可删的旧安装包');
  process.exit(0);
}

for (const key of plan.deleteKeys) {
  console.log(`删除 ${key}`);
}

const deleteList = path.join(os.tmpdir(), `qiniu-release-delete-${process.pid}.txt`);
fs.writeFileSync(deleteList, `${plan.deleteKeys.join('\n')}\n`);
const deleted = capture('qshell', ['batchdelete', '-y', '-i', deleteList, bucket]);
if (deleted.code !== 0) {
  throw new Error(`batchdelete 失败，部分对象可能未删\n${deleted.stderr}\n${deleted.stdout}`);
}
console.log(`已删除 ${plan.deleteKeys.length} 个旧安装包对象`);

function releaseVersion(): string {
  const raw = requiredEnv('RELEASE_VERSION').trim();
  if (raw.startsWith('v') || raw.startsWith('V')) {
    return raw.slice(1);
  }
  return raw;
}

function capture(command: string, args: string[], maxBuffer = 8 * 1024 * 1024): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? `${result.stderr ?? ''}\n${result.error.message}` : (result.stderr ?? ''),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}
