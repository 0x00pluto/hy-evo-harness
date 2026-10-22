import { compareSemver, isSemver } from './plugin-catalog.ts';

export const RELEASE_OBJECT_PREFIX = 'dex-buddy/';
export const DEFAULT_RELEASE_KEEP = 3;

/** 非捕获的 X.Y.Z，外层再包一层捕获整段版本号。 */
const SEMVER = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';

/** 七牛 dex-buddy/ 根下、带版本号的安装包与 blockmap。子目录（plugins、runtimes）不认。 */
const VERSIONED_RELEASE_NAME = new RegExp(
  [
    `^dex-buddy-(${SEMVER})-setup\\.exe(?:\\.blockmap)?$`,
    `^dex-buddy-(${SEMVER})\\.dmg(?:\\.blockmap)?$`,
    `^Dex\\.Buddy-(${SEMVER})-universal-mac\\.zip(?:\\.blockmap)?$`,
    `^dex-buddy-(${SEMVER})-mac\\.zip(?:\\.blockmap)?$`,
  ].join('|'),
  'i',
);

export interface ReleaseRetentionPlan {
  keepVersions: string[];
  deleteKeys: string[];
}

/** listbucket / listbucket2 输出：每行第一列是对象键。 */
export function objectKeysFromList(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const key = line.split('\t')[0]?.trim() ?? '';
    if (!key || key === 'Key') continue;
    keys.push(key);
  }
  return keys;
}

export function isTopLevelReleaseKey(key: string): boolean {
  if (!key.startsWith(RELEASE_OBJECT_PREFIX)) return false;
  const name = key.slice(RELEASE_OBJECT_PREFIX.length);
  return name.length > 0 && !name.includes('/');
}

/** 从顶层对象键认出安装包版本；认不出返回 null。 */
export function versionFromReleaseKey(key: string): string | null {
  if (!isTopLevelReleaseKey(key)) return null;
  const name = key.slice(RELEASE_OBJECT_PREFIX.length);
  const match = VERSIONED_RELEASE_NAME.exec(name);
  if (!match) return null;
  for (let index = 1; index < match.length; index += 1) {
    const part = match[index];
    if (part && isSemver(part)) return part;
  }
  return null;
}

export function parseReleaseKeep(raw: string | undefined, fallback = DEFAULT_RELEASE_KEEP): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^[1-9]\d*$/.test(raw.trim())) {
    throw new Error(`QINIU_RELEASE_KEEP 必须是正整数，收到 ${JSON.stringify(raw)}`);
  }
  return Number(raw.trim());
}

/**
 * 按 SemVer 从新到旧保留 keep 个版本的整组安装包；protectVersion 始终保留。
 * latest*.yml、子目录、认不出版本的键不进删除列表。
 */
export function planReleaseRetention(
  keys: readonly string[],
  options: { keep: number; protectVersion: string },
): ReleaseRetentionPlan {
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error(`keep 必须是正整数，收到 ${options.keep}`);
  }
  if (!isSemver(options.protectVersion)) {
    throw new Error(`protectVersion 必须是 X.Y.Z，收到 ${JSON.stringify(options.protectVersion)}`);
  }

  const byVersion = new Map<string, string[]>();
  for (const key of keys) {
    const version = versionFromReleaseKey(key);
    if (!version) continue;
    const group = byVersion.get(version);
    if (group) group.push(key);
    else byVersion.set(version, [key]);
  }

  const versions = [...byVersion.keys()].sort((left, right) => {
    const cmp = compareSemver(right, left);
    return cmp ?? 0;
  });

  const keep = new Set<string>();
  for (const version of versions) {
    if (keep.size >= options.keep) break;
    keep.add(version);
  }
  keep.add(options.protectVersion);

  const keepVersions = [...keep].sort((left, right) => {
    const cmp = compareSemver(right, left);
    return cmp ?? 0;
  });

  const deleteKeys: string[] = [];
  for (const [version, group] of byVersion) {
    if (keep.has(version)) continue;
    deleteKeys.push(...group);
  }
  deleteKeys.sort();

  return { keepVersions, deleteKeys };
}
