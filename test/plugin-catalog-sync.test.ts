import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  githubRemoteUrl,
  highestSemverTag,
  parsePluginRepos,
  pluginZipObjectKey,
  syncPluginCatalog,
  tagsFromLsRemote,
  type CatalogSyncClient,
  type PreparedPlugin,
} from '../src/main/plugin-catalog-sync.ts';

const allowlistPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.github/plugin-repos.json');

test('授权名单只接受不重复的 owner/name，漫剧仓库在名单里', () => {
  assert.deepEqual(parsePluginRepos('["octo/one","octo/two"]'), ['octo/one', 'octo/two']);
  assert.ok(parsePluginRepos(fs.readFileSync(allowlistPath, 'utf8')).includes('0x00pluto/evo_agent_team_manju-master'));
  assert.throws(() => parsePluginRepos('{"repos":[]}'), /数组/);
  assert.throws(() => parsePluginRepos('["https://github.com/octo/one"]'), /owner\/name/);
  assert.throws(() => parsePluginRepos('["octo/one","octo/one"]'), /重复/);
});

test('只发布最高的 vX.Y.Z，忽略剥引用和不合格 tag', () => {
  const text = [
    'aaa\trefs/tags/v0.1.0',
    'bbb\trefs/tags/v0.2.0',
    'ccc\trefs/tags/v0.2.0^{}',
    'ddd\trefs/tags/v0.10.0',
    'eee\trefs/tags/v1.0',
    'fff\trefs/tags/latest',
  ].join('\n');
  assert.equal(highestSemverTag(tagsFromLsRemote(text)), 'v0.10.0');
  assert.equal(highestSemverTag(['v0.2.0', 'v0.9.0']), 'v0.9.0');
  assert.equal(highestSemverTag(['latest']), null);
  assert.equal(pluginZipObjectKey('manju-studio', '0.2.0'), 'dex-buddy/plugins/manju-studio/0.2.0.zip');
  assert.equal(githubRemoteUrl('octo/demo'), 'https://github.com/octo/demo.git');
  assert.equal(
    githubRemoteUrl('octo/demo', 'a b'),
    'https://x-access-token:a%20b@github.com/octo/demo.git',
  );
});

test('一个仓库失败时仍发布另一个，并在全部处理完后合成目录', async () => {
  const uploaded: string[] = [];
  let rebuilt = 0;
  const client = fakeClient({
    async listTags(repository) {
      return repository === 'bad/repo' ? ['v0.1.0'] : ['v0.1.0', 'v0.2.0', 'nope'];
    },
    async prepare(repository, tag) {
      if (repository === 'bad/repo') throw new Error('清单版本 0.0.1 与 tag v0.1.0 不一致');
      assert.equal(tag, 'v0.2.0');
      return plugin(repository, tag);
    },
    async upload(item) {
      uploaded.push(item.id);
    },
    async rebuild(published) {
      rebuilt += 1;
      assert.deepEqual(published.map((item) => item.version), ['0.2.0']);
    },
  });
  const report = await syncPluginCatalog(['bad/repo', 'ok/repo'], client);
  assert.deepEqual(uploaded, ['ok-plugin']);
  assert.equal(rebuilt, 1);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0]?.message ?? '', /清单版本/);
});

test('七牛上已有 zip 时不上传，也没有新包就不合成目录', async () => {
  let uploaded = 0;
  let rebuilt = 0;
  const client = fakeClient({
    async listTags() {
      return ['v0.2.0'];
    },
    async prepare(repository, tag) {
      return plugin(repository, tag);
    },
    async hasZip() {
      return true;
    },
    async upload() {
      uploaded += 1;
    },
    async rebuild() {
      rebuilt += 1;
    },
  });
  const report = await syncPluginCatalog(['octo/demo'], client);
  assert.equal(uploaded, 0);
  assert.equal(rebuilt, 0);
  assert.equal(report.skipped.length, 1);
  assert.deepEqual(report.failures, []);
});

test('没有合格 tag 记失败，不挡住后面的仓库', async () => {
  const seen: string[] = [];
  const client = fakeClient({
    async listTags(repository) {
      seen.push(repository);
      return repository === 'octo/empty' ? ['latest'] : ['v1.0.0'];
    },
    async prepare(repository, tag) {
      return plugin(repository, tag);
    },
  });
  const report = await syncPluginCatalog(['octo/empty', 'octo/ready'], client);
  assert.deepEqual(seen, ['octo/empty', 'octo/ready']);
  assert.equal(report.published.length, 1);
  assert.match(report.failures[0]?.message ?? '', /没有 vX\.Y\.Z/);
});

function plugin(repository: string, tag: string): PreparedPlugin {
  return {
    repository,
    tag,
    id: repository === 'ok/repo' ? 'ok-plugin' : 'demo',
    version: tag.slice(1),
    zipPath: '/tmp/demo.zip',
    jsonPath: '/tmp/demo.json',
  };
}

function fakeClient(overrides: Partial<CatalogSyncClient>): CatalogSyncClient {
  return {
    async listTags() {
      return [];
    },
    async prepare(repository, tag) {
      return plugin(repository, tag);
    },
    async hasZip() {
      return false;
    },
    async upload() {},
    async rebuild() {},
    ...overrides,
  };
}
