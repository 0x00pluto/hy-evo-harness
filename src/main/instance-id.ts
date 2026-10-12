import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const INSTANCE_ID = /^dev-[0-9a-f]{32}$/;

/** 去掉末尾分隔符。Windows 上再折叠大小写，使同一文件夹只有一个 id。 */
export function instancePathKey(realAbsolutePath: string, platform: NodeJS.Platform = process.platform): string {
  let key = realAbsolutePath.replace(/[\\/]+$/, '');
  if (key === '') key = realAbsolutePath;
  if (platform === 'win32') key = key.toLowerCase();
  return key;
}

export function instanceIdForPath(realAbsolutePath: string, platform: NodeJS.Platform = process.platform): string {
  const hex = createHash('sha256').update(instancePathKey(realAbsolutePath, platform)).digest('hex').slice(0, 32);
  return `dev-${hex}`;
}

export function isInstanceId(value: string): boolean {
  return INSTANCE_ID.test(value);
}

export function sameDirectory(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  return instancePathKey(left, platform) === instancePathKey(right, platform);
}

/** 真实绝对路径，不含末尾分隔符。大小写折叠只发生在算 id 时。 */
export function canonicalDirectory(input: string): string {
  const real = fs.realpathSync(path.resolve(input));
  const stripped = real.replace(/[\\/]+$/, '');
  return stripped === '' ? real : stripped;
}
