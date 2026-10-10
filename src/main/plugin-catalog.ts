import path from 'node:path';
import { isPluginId } from './manifest.ts';

export const PLUGIN_CDN_HOST = 'oss.ai.66plat.com';
export const PLUGIN_CDN_BASE = `https://${PLUGIN_CDN_HOST}/dex-buddy/plugins`;
export const PLUGIN_CATALOG_URL = `${PLUGIN_CDN_BASE}/index.json`;
export const MAX_PLUGIN_ZIP_BYTES = 512 * 1024 * 1024;
export const MAX_CATALOG_BYTES = 1024 * 1024;
export const OTHER_CATEGORY = '其他';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_HEX = /^[a-f0-9]{64}$/i;
const ICON_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);

export interface PluginRelease {
  id: string;
  displayName: string;
  version: string;
  description?: string;
  category?: string;
  iconUrl?: string;
  downloadUrl: string;
  sha256: string;
}

export interface ReleaseCategoryGroup<T extends { category?: string; displayName: string }> {
  category: string;
  plugins: T[];
}

export interface PluginCatalog {
  generatedAt: string;
  plugins: PluginRelease[];
}

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}

export function versionFromTag(tag: string): string {
  if (!tag.startsWith('v')) {
    throw new Error('tag 必须以 v 开头');
  }
  const version = tag.slice(1);
  if (!isSemver(version)) {
    throw new Error('tag 必须是 vX.Y.Z');
  }
  return version;
}

/** 只比较 X.Y.Z。任一端不是这种版本号时返回 null，调用方不要据此提示更新。 */
export function compareSemver(left: string, right: string): number | null {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

export function pluginZipUrl(id: string, version: string): string {
  return `${PLUGIN_CDN_BASE}/${id}/${version}.zip`;
}

export function pluginIconUrl(id: string, version: string, ext: string): string {
  return `${PLUGIN_CDN_BASE}/${id}/${version}.icon.${ext.toLowerCase()}`;
}

/** 预计安装目录。id 已经过清单校验，渲染进程不要自己拼用户数据目录。 */
export function pluginInstallPath(userPluginsDir: string, id: string): string {
  if (!isPluginId(id)) throw new Error('插件 id 无效');
  return path.join(path.resolve(userPluginsDir), id);
}

export function assertAllowedCatalogUrl(value: string): void {
  const url = readHttpsUrl(value);
  if (url.hostname !== PLUGIN_CDN_HOST || url.pathname !== '/dex-buddy/plugins/index.json') {
    throw new Error('插件目录地址不在允许范围内');
  }
}

export function assertAllowedPluginZipUrl(value: string, id: string, version: string): void {
  const url = readHttpsUrl(value);
  const expected = `/dex-buddy/plugins/${id}/${version}.zip`;
  if (url.hostname !== PLUGIN_CDN_HOST || url.pathname !== expected) {
    throw new Error('插件下载地址不在允许范围内');
  }
}

export function assertAllowedPluginIconUrl(value: string, id: string, version: string): void {
  const url = readHttpsUrl(value);
  const match = /^\/dex-buddy\/plugins\/([^/]+)\/([^/]+)\.icon\.([a-z0-9]+)$/.exec(url.pathname);
  const pathId = match?.[1];
  const pathVersion = match?.[2];
  const ext = match?.[3];
  if (
    url.hostname !== PLUGIN_CDN_HOST
    || pathId !== id
    || pathVersion !== version
    || !ext
    || !ICON_EXTENSIONS.has(ext)
  ) {
    throw new Error('插件图标地址不在允许范围内');
  }
}

export function parsePluginRelease(value: unknown): PluginRelease | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !isPluginId(raw.id)) return null;
  if (typeof raw.displayName !== 'string' || raw.displayName.trim() === '') return null;
  if (typeof raw.version !== 'string' || !isSemver(raw.version)) return null;
  if (typeof raw.downloadUrl !== 'string' || typeof raw.sha256 !== 'string' || !SHA256_HEX.test(raw.sha256)) {
    return null;
  }
  try {
    assertAllowedPluginZipUrl(raw.downloadUrl, raw.id, raw.version);
  } catch {
    return null;
  }
  const release: PluginRelease = {
    id: raw.id,
    displayName: raw.displayName.trim(),
    version: raw.version,
    downloadUrl: raw.downloadUrl,
    sha256: raw.sha256.toLowerCase(),
  };
  if (typeof raw.description === 'string') {
    const description = raw.description.trim();
    if (description !== '' && description.length <= 280) release.description = description;
  }
  const category = optionalCategory(raw.category);
  if (category) release.category = category;
  const iconUrl = optionalIconUrl(raw.iconUrl, release.id, release.version);
  if (iconUrl) release.iconUrl = iconUrl;
  return release;
}

export function parsePluginCatalog(value: unknown): PluginCatalog {
  if (!value || typeof value !== 'object') {
    throw new Error('插件目录不是对象');
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.plugins)) {
    throw new Error('插件目录缺少 plugins');
  }
  const plugins: PluginRelease[] = [];
  for (const entry of raw.plugins) {
    const release = parsePluginRelease(entry);
    if (release) plugins.push(release);
  }
  const generatedAt = typeof raw.generatedAt === 'string' && raw.generatedAt.trim() !== ''
    ? raw.generatedAt
    : new Date(0).toISOString();
  return { generatedAt, plugins: selectLatestReleases(plugins) };
}

export function selectLatestReleases(releases: PluginRelease[]): PluginRelease[] {
  const byId = new Map<string, PluginRelease>();
  for (const release of releases) {
    const current = byId.get(release.id);
    if (!current) {
      byId.set(release.id, release);
      continue;
    }
    const order = compareSemver(release.version, current.version);
    if (order !== null && order > 0) byId.set(release.id, release);
  }
  return Array.from(byId.values()).sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh'));
}

export function buildPluginCatalog(releases: PluginRelease[], generatedAt: string): PluginCatalog {
  return { generatedAt, plugins: selectLatestReleases(releases) };
}

/** 缺省和作者写成「其他」的归在同一段，这一段固定在最后。 */
export function groupReleasesByCategory<T extends { category?: string; displayName: string }>(
  items: readonly T[],
): Array<ReleaseCategoryGroup<T>> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const category = item.category && item.category !== OTHER_CATEGORY ? item.category : OTHER_CATEGORY;
    const list = groups.get(category);
    if (list) list.push(item);
    else groups.set(category, [item]);
  }
  for (const list of groups.values()) {
    list.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
  }
  const names = Array.from(groups.keys()).filter((name) => name !== OTHER_CATEGORY);
  names.sort((left, right) => left.localeCompare(right, 'zh-CN'));
  if (groups.has(OTHER_CATEGORY)) names.push(OTHER_CATEGORY);
  return names.map((category) => ({ category, plugins: groups.get(category) ?? [] }));
}

export function releaseKeysFromList(text: string): string[] {
  const keys: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const key = line.split('\t')[0]?.trim() ?? '';
    if (/^dex-buddy\/plugins\/[a-z0-9][a-z0-9-]{0,63}\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.json$/.test(key)) {
      keys.push(key);
    }
  }
  return keys;
}

function optionalCategory(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 32) return undefined;
  return trimmed;
}

function optionalIconUrl(value: unknown, id: string, version: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    assertAllowedPluginIconUrl(value, id, version);
  } catch {
    return undefined;
  }
  return value;
}

function semverParts(value: string): [number, number, number] | null {
  const match = SEMVER.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function readHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('插件地址无效');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('插件地址必须是 https');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('插件地址不能带查询参数');
  }
  return url;
}
