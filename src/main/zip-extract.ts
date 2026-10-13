import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw, crc32 } from 'node:zlib';

// Windows 不带 unzip，各机 PATH 里有没有这条命令也不一样。插件包只使用存储或 deflate，
// 在进程内解压，Mac / Windows / Linux 走同一条路径。

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_MARKER = 0xffffffff;
const MAX_EOCD_COMMENT = 65535;
const FLAG_ENCRYPTED = 0x1;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

interface ZipEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  externalAttrs: number;
}

export function listZipEntryNames(zipFilePath: string): string[] {
  return readCentralDirectory(zipFilePath).map((entry) => entry.name);
}

export async function extractZip(zipFilePath: string, destDir: string): Promise<void> {
  const root = path.resolve(destDir);
  fs.mkdirSync(root, { recursive: true });
  for (const entry of readCentralDirectory(zipFilePath)) {
    const dest = resolveInside(root, entry.name);
    if (isDirectory(entry)) {
      fs.mkdirSync(dest, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await writeEntry(zipFilePath, entry, dest);
  }
}

function readCentralDirectory(zipFilePath: string): ZipEntry[] {
  const stat = fs.statSync(zipFilePath);
  if (!stat.isFile() || stat.size < 22) throw unreadable();
  const tailLen = Math.min(stat.size, 22 + MAX_EOCD_COMMENT);
  const tail = Buffer.alloc(tailLen);
  const fd = fs.openSync(zipFilePath, 'r');
  try {
    if (fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen) !== tailLen) throw unreadable();
    const eocdAt = findEocd(tail);
    const eocd = tail.subarray(eocdAt, eocdAt + 22);
    const disk = eocd.readUInt16LE(4);
    const cdDisk = eocd.readUInt16LE(6);
    const diskEntries = eocd.readUInt16LE(8);
    const totalEntries = eocd.readUInt16LE(10);
    const cdSize = eocd.readUInt32LE(12);
    const cdOffset = eocd.readUInt32LE(16);
    // 0xFFFF / 0xFFFFFFFF 表示真正的值在 ZIP64 尾部。插件包用不到，直接拒绝。
    if (
      disk !== 0 ||
      cdDisk !== 0 ||
      diskEntries === 0xffff ||
      totalEntries === 0xffff ||
      cdSize === ZIP64_MARKER ||
      cdOffset === ZIP64_MARKER ||
      diskEntries !== totalEntries
    ) {
      throw unsupported();
    }
    if (cdOffset > stat.size || cdSize > stat.size - cdOffset) throw unreadable();
    const cd = Buffer.alloc(cdSize);
    if (cdSize > 0 && fs.readSync(fd, cd, 0, cdSize, cdOffset) !== cdSize) throw unreadable();
    return parseCentralDirectory(cd, totalEntries);
  } finally {
    fs.closeSync(fd);
  }
}

function findEocd(tail: Buffer): number {
  for (let offset = tail.length - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== EOCD_SIG) continue;
    const commentLen = tail.readUInt16LE(offset + 20);
    if (offset + 22 + commentLen === tail.length) return offset;
  }
  throw unreadable();
}

function parseCentralDirectory(cd: Buffer, totalEntries: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > cd.length || cd.readUInt32LE(offset) !== CENTRAL_SIG) throw unreadable();
    const flags = cd.readUInt16LE(offset + 8);
    const method = cd.readUInt16LE(offset + 10);
    const checksum = cd.readUInt32LE(offset + 16);
    const compressedSize = cd.readUInt32LE(offset + 20);
    const uncompressedSize = cd.readUInt32LE(offset + 24);
    const nameLen = cd.readUInt16LE(offset + 28);
    const extraLen = cd.readUInt16LE(offset + 30);
    const commentLen = cd.readUInt16LE(offset + 32);
    const externalAttrs = cd.readUInt32LE(offset + 38);
    const localHeaderOffset = cd.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const next = nameStart + nameLen + extraLen + commentLen;
    if (next > cd.length) throw unreadable();
    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
      throw unsupported();
    }
    if ((flags & FLAG_ENCRYPTED) !== 0 || (method !== METHOD_STORE && method !== METHOD_DEFLATE)) {
      throw unsupported();
    }
    if (isSymlink(externalAttrs)) throw unsupported();
    const name = cd.subarray(nameStart, nameStart + nameLen).toString('utf8');
    entries.push({
      name,
      method,
      crc32: checksum,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttrs,
    });
    offset = next;
  }
  return entries;
}

function isSymlink(externalAttrs: number): boolean {
  return ((externalAttrs >>> 16) & S_IFMT) === S_IFLNK;
}

function isDirectory(entry: ZipEntry): boolean {
  if (entry.name.endsWith('/') || entry.name.endsWith('\\')) return true;
  return ((entry.externalAttrs >>> 16) & S_IFMT) === S_IFDIR;
}

function resolveInside(root: string, entryName: string): string {
  if (!entryName || entryName.includes('\0')) throw new Error('压缩包包含非法路径');
  if (path.win32.isAbsolute(entryName) || path.posix.isAbsolute(entryName)) {
    throw new Error(`压缩包包含越界路径: ${entryName}`);
  }
  const parts = entryName.split(/[/\\]/).filter((part) => part.length > 0 && part !== '.');
  if (parts.includes('..') || parts.some((part) => part.includes(':'))) {
    throw new Error(`压缩包包含越界路径: ${entryName}`);
  }
  if (parts.length === 0) return root;
  const dest = path.resolve(root, ...parts);
  const relative = path.relative(root, dest);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`压缩包包含越界路径: ${entryName}`);
  }
  return dest;
}

async function writeEntry(zipFilePath: string, entry: ZipEntry, outPath: string): Promise<void> {
  if (entry.compressedSize === 0 && entry.uncompressedSize === 0) {
    if ((entry.crc32 >>> 0) !== 0) throw new Error('压缩包内容与声明不一致');
    fs.writeFileSync(outPath, Buffer.alloc(0));
    return;
  }
  if (entry.method === METHOD_STORE && entry.compressedSize !== entry.uncompressedSize) {
    throw new Error('压缩包内容与声明不一致');
  }
  const dataOffset = readDataOffset(zipFilePath, entry.localHeaderOffset);
  const size = fs.statSync(zipFilePath).size;
  if (dataOffset > size || entry.compressedSize > size - dataOffset) throw unreadable();
  const source = fs.createReadStream(zipFilePath, {
    start: dataOffset,
    end: dataOffset + entry.compressedSize - 1,
  });
  const decode = entry.method === METHOD_DEFLATE ? createInflateRaw() : new PassThrough();
  try {
    await pipeline(source, decode, verifyPayload(entry.crc32, entry.uncompressedSize), fs.createWriteStream(outPath));
  } catch (err) {
    fs.rmSync(outPath, { force: true });
    const message = err instanceof Error ? err.message : String(err);
    if (message === '压缩包内容与声明不一致' || message === '无法读取插件压缩包' || message === '压缩包格式不受支持') {
      throw err instanceof Error ? err : unreadable();
    }
    throw unreadable();
  }
}

function readDataOffset(zipFilePath: string, localHeaderOffset: number): number {
  const header = Buffer.alloc(30);
  const fd = fs.openSync(zipFilePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (localHeaderOffset > size - 30) throw unreadable();
    if (fs.readSync(fd, header, 0, 30, localHeaderOffset) !== 30 || header.readUInt32LE(0) !== LOCAL_SIG) {
      throw unreadable();
    }
    const nameLen = header.readUInt16LE(26);
    const extraLen = header.readUInt16LE(28);
    return localHeaderOffset + 30 + nameLen + extraLen;
  } finally {
    fs.closeSync(fd);
  }
}

function verifyPayload(expectedCrc: number, expectedSize: number): Transform {
  let seen = 0;
  let checksum = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      seen += buf.length;
      if (seen > expectedSize) {
        callback(new Error('压缩包内容与声明不一致'));
        return;
      }
      checksum = crc32(buf, checksum);
      callback(null, buf);
    },
    flush(callback) {
      if (seen !== expectedSize || (checksum >>> 0) !== (expectedCrc >>> 0)) {
        callback(new Error('压缩包内容与声明不一致'));
        return;
      }
      callback();
    },
  });
}

function unsupported(): Error {
  return new Error('压缩包格式不受支持');
}

function unreadable(): Error {
  return new Error('无法读取插件压缩包');
}
