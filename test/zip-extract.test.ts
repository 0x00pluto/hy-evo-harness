import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { installPluginZip } from '../src/main/install.ts';
import { ServiceRegistry } from '../src/main/registry.ts';
import { listZipEntryNames } from '../src/main/zip-extract.ts';
import type { Logger } from '../src/main/types.ts';

const silent: Logger = { info() {}, error() {} };

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-'));
}

interface ZipMember {
  name: string;
  data: Buffer;
  method?: number;
  flags?: number;
  externalAttrs?: number;
  /** 中央目录里改写压缩后大小，用来造 ZIP64 标记。 */
  compressedSize?: number;
}

function makeZip(entries: ZipMember[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 0;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data) >>> 0;
    const compressedSize = entry.compressedSize ?? payload.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const localRecord = Buffer.concat([local, name, payload]);
    locals.push(localRecord);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttrs ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localRecord.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function pluginZip(id: string, method: number): Buffer {
  const manifest = Buffer.from(
    JSON.stringify({ id, displayName: id, version: '1.0.0', type: 'headless', main: 'index.js' }),
  );
  const source = Buffer.from(
    'module.exports = { apply(ctx) { ctx.registerService("sampleTool", { ping() { return "from-zip"; } }); } };',
  );
  return makeZip([
    { name: `${id}/plugin.manifest.json`, data: manifest, method },
    { name: `${id}/index.js`, data: source, method },
  ]);
}

function writeZip(work: string, bytes: Buffer): string {
  const zipFilePath = path.join(work, 'plugin.zip');
  fs.writeFileSync(zipFilePath, bytes);
  return zipFilePath;
}

test('存储法和 deflate 都能装上带 manifest 的插件', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  for (const [method, id] of [
    [0, 'stored-tool'],
    [8, 'deflate-tool'],
  ] as const) {
    const zipFilePath = path.join(work, `${id}.zip`);
    fs.writeFileSync(zipFilePath, pluginZip(id, method));
    const installed = path.join(work, 'installed');
    const registry = new ServiceRegistry(silent);
    const list = await installPluginZip({ registry, zipFilePath, userPluginsDir: installed });
    assert.equal(list.installedId, id);
    assert.equal(fs.existsSync(path.join(installed, id, 'plugin.manifest.json')), true);
    assert.equal(await registry.callService('sampleTool', 'ping', []), 'from-zip');
    fs.rmSync(installed, { recursive: true, force: true });
    await registry.unloadPlugin(id);
  }
});

test('未置 UTF-8 标志时仍按 UTF-8 读文件名', () => {
  const flagged = makeZip([{ name: '说明.txt', data: Buffer.from('a'), flags: 0x800 }]);
  const plain = makeZip([{ name: '说明.txt', data: Buffer.from('a'), flags: 0 }]);
  const flaggedPath = path.join(os.tmpdir(), `dex-buddy-utf8-${process.pid}-flag.zip`);
  const plainPath = path.join(os.tmpdir(), `dex-buddy-utf8-${process.pid}-plain.zip`);
  fs.writeFileSync(flaggedPath, flagged);
  fs.writeFileSync(plainPath, plain);
  try {
    assert.deepEqual(listZipEntryNames(flaggedPath), ['说明.txt']);
    assert.deepEqual(listZipEntryNames(plainPath), ['说明.txt']);
  } finally {
    fs.rmSync(flaggedPath, { force: true });
    fs.rmSync(plainPath, { force: true });
  }
});

test('越界路径在列出后被拒绝，不留下插件目录', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const zipFilePath = path.join(work, 'bad.zip');
  fs.writeFileSync(zipFilePath, makeZip([{ name: '../evil.txt', data: Buffer.from('nope') }]));
  const installed = path.join(work, 'installed');
  const registry = new ServiceRegistry(silent);
  await assert.rejects(
    () => installPluginZip({ registry, zipFilePath, userPluginsDir: installed }),
    /越界/,
  );
  assert.equal(fs.existsSync(installed), false);
  assert.equal(fs.existsSync(path.join(work, 'evil.txt')), false);
  assert.equal(registry.getPluginList().length, 0);
});

test('加密、未知压缩方法、符号链接和 ZIP64 失败时不留下插件目录', async (t) => {
  const work = tempDir();
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const manifest = Buffer.from('{"id":"sample-tool"}');
  const cases = [
    makeZip([{ name: 'sample-tool/plugin.manifest.json', data: manifest, flags: 0x1 }]),
    makeZip([{ name: 'sample-tool/plugin.manifest.json', data: manifest, method: 12 }]),
    makeZip([{
      name: 'sample-tool/plugin.manifest.json',
      data: manifest,
      externalAttrs: (0o120777 << 16) >>> 0,
    }]),
    makeZip([{
      name: 'sample-tool/plugin.manifest.json',
      data: manifest,
      compressedSize: 0xffffffff,
    }]),
  ];
  for (const bytes of cases) {
    const installed = path.join(work, 'installed');
    const registry = new ServiceRegistry(silent);
    await assert.rejects(
      () => installPluginZip({ registry, zipFilePath: writeZip(work, bytes), userPluginsDir: installed }),
      /压缩包格式不受支持/,
    );
    assert.equal(fs.existsSync(installed), false);
    assert.equal(registry.getPluginList().length, 0);
  }
});
