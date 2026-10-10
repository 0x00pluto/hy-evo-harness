import { compareSemver } from './plugin-catalog.ts';

const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEMVER_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface PreparedPlugin {
  repository: string;
  tag: string;
  id: string;
  version: string;
  zipPath: string;
  jsonPath: string;
}

export interface CatalogSyncClient {
  listTags(repository: string): Promise<string[]>;
  prepare(repository: string, tag: string): Promise<PreparedPlugin>;
  hasZip(id: string, version: string): Promise<boolean>;
  upload(plugin: PreparedPlugin): Promise<void>;
  discard?(plugin: PreparedPlugin): Promise<void>;
  rebuild(published: PreparedPlugin[]): Promise<void>;
}

export interface CatalogSyncReport {
  published: PreparedPlugin[];
  skipped: PreparedPlugin[];
  failures: Array<{ repository: string; message: string }>;
}

export function parsePluginRepos(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('授权名单不是 JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('授权名单必须是数组');
  const repositories: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') throw new Error('授权名单里的每一项必须是 owner/name');
    const repository = entry.trim();
    assertRepositoryName(repository);
    if (repositories.includes(repository)) throw new Error(`授权名单重复：${repository}`);
    repositories.push(repository);
  }
  return repositories;
}

export function tagsFromLsRemote(text: string): string[] {
  const tags: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const ref = line.split('\t')[1]?.trim() ?? '';
    if (ref.startsWith('refs/tags/')) tags.push(ref);
  }
  return tags;
}

/** 只认 vX.Y.Z。annotated tag 的剥引用和更低版本都不参与发布。 */
export function highestSemverTag(names: readonly string[]): string | null {
  const tags = new Set<string>();
  for (const name of names) {
    const tag = name.trim().replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    if (SEMVER_TAG.test(tag)) tags.add(tag);
  }
  let best: string | null = null;
  for (const tag of tags) {
    if (!best || compareSemver(tag.slice(1), best.slice(1)) === 1) best = tag;
  }
  return best;
}

export function pluginZipObjectKey(id: string, version: string): string {
  return `dex-buddy/plugins/${id}/${version}.zip`;
}

export function assertRepositoryName(repository: string): void {
  const [owner, name] = repository.split('/');
  if (!REPOSITORY_NAME.test(repository) || owner === '.' || owner === '..' || name === '.' || name === '..') {
    throw new Error(`插件仓库须是 owner/name：${repository}`);
  }
}

/**
 * 先把每个仓库处理完再合成目录。后面的仓库失败时，前面已经传上的包仍会写进 index.json。
 */
export async function syncPluginCatalog(
  repositories: readonly string[],
  client: CatalogSyncClient,
): Promise<CatalogSyncReport> {
  const published: PreparedPlugin[] = [];
  const skipped: PreparedPlugin[] = [];
  const failures: Array<{ repository: string; message: string }> = [];
  for (const repository of repositories) {
    let plugin: PreparedPlugin | undefined;
    try {
      assertRepositoryName(repository);
      const tag = highestSemverTag(await client.listTags(repository));
      if (!tag) throw new Error('没有 vX.Y.Z tag');
      plugin = await client.prepare(repository, tag);
      if (await client.hasZip(plugin.id, plugin.version)) {
        skipped.push(plugin);
        continue;
      }
      await client.upload(plugin);
      published.push(plugin);
    } catch (error) {
      failures.push({
        repository,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (plugin) await client.discard?.(plugin);
    }
  }
  if (published.length > 0) await client.rebuild(published);
  return { published, skipped, failures };
}
