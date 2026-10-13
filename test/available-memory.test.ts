import assert from 'node:assert/strict';
import test from 'node:test';
import { availableBytes, readAvailableMemory } from '../src/main/available-memory.ts';

test('macOS 用 free 加 file-backed，不用接近零的 free 单独当可用内存', () => {
  assert.equal(availableBytes('darwin', { free: 1, fileBacked: 4 * 1024 * 1024 }), (1 + 4 * 1024 * 1024) * 1024);
  assert.equal(availableBytes('darwin', { free: 0, fileBacked: 0 }), 0);
  assert.equal(availableBytes('darwin', { free: 10 }), null);
  assert.equal(availableBytes('darwin', { fileBacked: 10 }), null);
});

test('Linux 用 MemAvailable，Windows 用 free', () => {
  assert.equal(availableBytes('linux', { available: 2048, free: 1 }), 2048 * 1024);
  assert.equal(availableBytes('linux', { free: 2048 }), null);
  assert.equal(availableBytes('win32', { free: 4096, available: 1 }), 4096 * 1024);
  assert.equal(availableBytes('win32', {}), null);
});

test('读不到或平台不认识时明确失败', () => {
  assert.equal(availableBytes('freebsd', { free: 10, available: 10, fileBacked: 10 }), null);
  assert.deepEqual(readAvailableMemory('linux', () => {
    throw new Error('boom');
  }), { ok: false });
  assert.deepEqual(readAvailableMemory('linux', () => ({ available: 2 })), { ok: true, bytes: 2048 });
});
