import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icnsPath = path.join(root, 'build', 'icon.icns');

/** Read ICNS OSType tags in file order. */
function listIcnsTypes(buf: Buffer): string[] {
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'icns');
  const types: string[] = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const ostype = buf.subarray(offset, offset + 4).toString('ascii');
    const size = buf.readUInt32BE(offset + 4);
    types.push(ostype);
    if (size < 8) break;
    offset += size;
  }
  return types;
}

test('build/icon.icns 用 Apple 小图标块，不用会花屏的 icp4/icp5/icp6', () => {
  assert.ok(fs.existsSync(icnsPath), `缺少 ${icnsPath}`);
  const types = listIcnsTypes(fs.readFileSync(icnsPath));
  for (const need of ['ic04', 'ic05']) {
    assert.ok(types.includes(need), `应含 ${need}，实际: ${types.join(',')}`);
  }
  for (const bad of ['icp4', 'icp5', 'icp6']) {
    assert.ok(!types.includes(bad), `不应含 ${bad}，实际: ${types.join(',')}`);
  }
});
