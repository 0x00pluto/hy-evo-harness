import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POINTS_NAV_ID,
  accountHeadline,
  balanceLabel,
  isLoginPending,
  pointsNavMatches,
} from '../src/renderer/account-session.js';
import { PKCE_WAIT_MS } from '../src/main/gateway-session.ts';

test('积分导航 id 与搜索', () => {
  assert.equal(POINTS_NAV_ID, '@points');
  assert.equal(pointsNavMatches(''), true);
  assert.equal(pointsNavMatches('积分'), true);
  assert.equal(pointsNavMatches('不存在'), false);
});

test('三态摘要文案', () => {
  assert.equal(
    accountHeadline({
      signedIn: false,
      phoneMasked: null,
      balance: null,
      currency: null,
      login: { phase: 'idle' },
    }),
    '未登录',
  );
  assert.equal(
    accountHeadline({
      signedIn: false,
      phoneMasked: null,
      balance: null,
      currency: null,
      login: { phase: 'waiting_callback' },
    }),
    '登录中',
  );
  assert.equal(
    accountHeadline({
      signedIn: true,
      phoneMasked: '138****0000',
      balance: 1,
      currency: 'credits',
      login: { phase: 'idle' },
    }),
    '138****0000',
  );
});

test('积分文案不用 credits', () => {
  assert.equal(balanceLabel(0, 'credits'), '0 积分');
  assert.equal(balanceLabel(null, 'credits'), '积分未知');
});

test('登录进行中判定不含 idle', () => {
  assert.equal(
    isLoginPending({
      signedIn: false,
      phoneMasked: null,
      balance: null,
      currency: null,
      login: { phase: 'waiting_callback' },
    }),
    true,
  );
  assert.equal(
    isLoginPending({
      signedIn: false,
      phoneMasked: null,
      balance: null,
      currency: null,
      login: { phase: 'idle' },
    }),
    false,
  );
});

test('PKCE 等待为 5 分钟', () => {
  assert.equal(PKCE_WAIT_MS, 5 * 60 * 1000);
});
