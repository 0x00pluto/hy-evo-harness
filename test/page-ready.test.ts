import assert from 'node:assert/strict';
import test from 'node:test';
import { stylesheetReady } from '../src/renderer/page-ready.js';

test('没有 stylesheet 链接视为就绪', () => {
  assert.deepEqual(stylesheetReady({ total: 0, loaded: 0 }), { ok: true, reason: 'no-sheets' });
});

test('全部 sheet 可读则就绪', () => {
  assert.deepEqual(stylesheetReady({ total: 2, loaded: 2 }), { ok: true, reason: 'ready' });
  assert.deepEqual(stylesheetReady({ total: 1, loaded: 3 }), { ok: true, reason: 'ready' });
});

test('有失败或未齐则未就绪', () => {
  assert.deepEqual(stylesheetReady({ total: 2, loaded: 1 }), { ok: false, reason: 'pending' });
  assert.deepEqual(stylesheetReady({ total: 1, loaded: 0 }), { ok: false, reason: 'pending' });
});

test('非法报告拒绝', () => {
  assert.equal(stylesheetReady(null).ok, false);
  assert.equal(stylesheetReady(undefined).ok, false);
  assert.equal(stylesheetReady({}).ok, false);
  assert.equal(stylesheetReady({ total: -1, loaded: 0 }).ok, false);
  assert.equal(stylesheetReady({ total: 1, loaded: NaN }).ok, false);
});
