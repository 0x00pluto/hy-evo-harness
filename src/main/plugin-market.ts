import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertAllowedCatalogUrl,
  assertAllowedPluginZipUrl,
  MAX_CATALOG_BYTES,
  MAX_PLUGIN_ZIP_BYTES,
  parsePluginCatalog,
  PLUGIN_CATALOG_URL,
  type PluginCatalog,
  type PluginRelease,
} from './plugin-catalog.ts';
import { installPluginZip } from './install.ts';
import type { ServiceRegistry } from './registry.ts';
import type { PluginSummary } from './types.ts';

export async function fetchPluginCatalog(): Promise<PluginCatalog> {
  assertAllowedCatalogUrl(PLUGIN_CATALOG_URL);
  const response = await fetch(PLUGIN_CATALOG_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`插件目录请求失败 (${response.status})`);
  }
  assertAllowedCatalogUrl(response.url);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) {
    throw new Error('插件目录过大');
  }
  return parsePluginCatalog(JSON.parse(text) as unknown);
}

export function findRelease(catalog: PluginCatalog, id: string): PluginRelease {
  const release = catalog.plugins.find((item) => item.id === id);
  if (!release) throw new Error('插件中心没有这个插件');
  return release;
}

export async function downloadVerifiedZip(release: PluginRelease, dest: string): Promise<void> {
  assertAllowedPluginZipUrl(release.downloadUrl, release.id, release.version);
  const response = await fetch(release.downloadUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`插件下载失败 (${response.status})`);
  }
  assertAllowedPluginZipUrl(response.url, release.id, release.version);
  if (!response.body) throw new Error('插件下载没有内容');
  const hash = createHash('sha256');
  let total = 0;
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > MAX_PLUGIN_ZIP_BYTES) {
        callback(new Error('插件包过大'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(source, hasher, fs.createWriteStream(dest));
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
  const digest = hash.digest('hex');
  if (digest !== release.sha256) {
    fs.rmSync(dest, { force: true });
    throw new Error('插件包校验不一致');
  }
}

export async function installCatalogRelease(options: {
  registry: ServiceRegistry;
  release: PluginRelease;
  zipFilePath: string;
  userPluginsDir: string;
}): Promise<{ installedId: string; plugins: PluginSummary[] }> {
  return installPluginZip({
    registry: options.registry,
    zipFilePath: options.zipFilePath,
    userPluginsDir: options.userPluginsDir,
  });
}
