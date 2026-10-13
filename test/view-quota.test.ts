import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryAllowance, selectEvictions } from '../src/renderer/view-quota.js';

const GIB = 1024 ** 3;

function resident(id: string, lastHotAt: number) {
  return { id, lastHotAt };
}

test('可用内存按 GiB 分档，读不到时名额为 5', () => {
  assert.equal(memoryAllowance(4 * GIB), 5);
  assert.equal(memoryAllowance(100 * GIB), 5);
  assert.equal(memoryAllowance(4 * GIB - 1), 3);
  assert.equal(memoryAllowance(2 * GIB), 3);
  assert.equal(memoryAllowance(2 * GIB - 1), 1);
  assert.equal(memoryAllowance(0), 1);
  assert.equal(memoryAllowance(null), 5);
  assert.equal(memoryAllowance(Number.NaN), 5);
});

test('硬上限是 5，第 6 个驻留只拆最久没看的', () => {
  const residents = [1, 2, 3, 4, 5, 6].map((n) => resident(`p${n}`, n));
  const evict = selectEvictions({
    residents,
    protectedId: 'p6',
    availableBytes: 4 * GIB,
  });
  assert.deepEqual(evict, ['p1']);
  assert.equal(residents.length - evict.length, 5);
  assert.equal(evict.includes('p6'), false);
});

test('受保护 id 不出现在拆掉列表，余量为 1 时只留它', () => {
  const residents = ['a', 'b', 'c'].map((id) => resident(id, 1));
  const evict = selectEvictions({
    residents,
    protectedId: 'b',
    availableBytes: GIB,
  });
  assert.deepEqual(evict, ['a', 'c']);
  assert.equal(evict.includes('b'), false);
});

test('相同时间戳按插件 id 字典序拆靠前的', () => {
  const residents = ['c', 'a', 'b', 'd'].map((id) => resident(id, 10));
  const evict = selectEvictions({
    residents,
    protectedId: null,
    availableBytes: 2 * GIB,
  });
  assert.deepEqual(evict, ['a']);
  const left = residents.filter((item) => !evict.includes(item.id)).map((item) => item.id);
  assert.deepEqual(left, ['c', 'b', 'd']);
});

test('刚看过的温界面排在后面，不会第一个被拆', () => {
  const residents = [
    resident('old', 1),
    resident('mid', 2),
    resident('just-left', 100),
    resident('hot', 100),
  ];
  const evict = selectEvictions({
    residents,
    protectedId: 'hot',
    availableBytes: 2 * GIB,
  });
  assert.deepEqual(evict, ['old']);
  assert.equal(evict.includes('just-left'), false);
  assert.equal(evict.includes('hot'), false);
});

test('输出之后驻留数不超过有效名额', () => {
  const residents = ['m', 'a', 'z', 'b'].map((id, index) => resident(id, index));
  for (const availableBytes of [null, GIB, 2 * GIB, 3 * GIB, 4 * GIB, 8 * GIB]) {
    const evict = selectEvictions({ residents, protectedId: 'z', availableBytes });
    const left = residents.filter((item) => !evict.includes(item.id));
    assert.ok(left.length <= memoryAllowance(availableBytes));
    assert.equal(evict.includes('z'), false);
    assert.ok(left.some((item) => item.id === 'z'));
  }
});
