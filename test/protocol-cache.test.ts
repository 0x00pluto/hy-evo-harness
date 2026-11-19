import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearPluginPartitionCache,
  pluginAssetResponse,
  pluginAssetResponseHeaders,
  withPluginAssetCacheHeaders,
} from '../src/main/protocol.ts';

test('插件资源响应头要求每次校验最新内容', () => {
  assert.deepEqual(pluginAssetResponseHeaders(), { 'Cache-Control': 'no-cache' });
});

test('pluginAssetResponse 给成功与 404 都带上 no-cache', async () => {
  const ok = pluginAssetResponse('body', { status: 200 });
  assert.equal(ok.headers.get('Cache-Control'), 'no-cache');
  assert.equal(await ok.text(), 'body');

  const missing = pluginAssetResponse('Not found', { status: 404 });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('Cache-Control'), 'no-cache');
});

test('withPluginAssetCacheHeaders 覆盖并保留原状态码', async () => {
  const source = new Response('css', {
    status: 200,
    headers: { 'Content-Type': 'text/css', 'Cache-Control': 'max-age=3600' },
  });
  const next = await withPluginAssetCacheHeaders(source);
  assert.equal(next.status, 200);
  assert.equal(next.headers.get('Cache-Control'), 'no-cache');
  assert.equal(next.headers.get('Content-Type'), 'text/css');
  assert.equal(await next.text(), 'css');
});

test('clearPluginPartitionCache 空 id 直接返回；无 Electron 时失败不抛', async () => {
  await clearPluginPartitionCache('');
  await clearPluginPartitionCache('   ');
  // node:test 环境没有 Electron；封装须吞掉 require/clearCache 错误。
  await clearPluginPartitionCache('sample-plugin');
});
