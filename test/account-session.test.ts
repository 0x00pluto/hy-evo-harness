import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POINTS_NAV_ID,
  accountHeadline,
  balanceLabel,
  buyoutItems,
  buyoutLabel,
  isLoginPending,
  pointsNavMatches,
} from '../src/renderer/account-session.js';
import { PKCE_WAIT_MS } from '../src/main/gateway-session.ts';

test('积分导航 id 与搜索', () => {
  assert.equal(POINTS_NAV_ID, '@points');
  assert.equal(pointsNavMatches(''), true);
  assert.equal(pointsNavMatches('积分'), true);
  assert.equal(pointsNavMatches('商城'), true);
  assert.equal(pointsNavMatches('已购'), true);
  assert.equal(pointsNavMatches('购买积分'), true);
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

test('买断列表只在已登录时返回', () => {
  assert.deepEqual(
    buyoutItems({
      signedIn: false,
      phoneMasked: null,
      balance: null,
      currency: null,
      buyouts: [{ pluginId: 'x', displayName: 'X' }],
      login: { phase: 'idle' },
    }),
    [],
  );
  assert.deepEqual(
    buyoutItems({
      signedIn: true,
      phoneMasked: '138****0000',
      balance: 1,
      currency: 'credits',
      buyouts: [{ pluginId: 'ai-comic-master', displayName: 'AI 漫画大师' }],
      login: { phase: 'idle' },
    }),
    [{ pluginId: 'ai-comic-master', displayName: 'AI 漫画大师' }],
  );
});

test('已购插件显示名称 (id)', () => {
  assert.equal(
    buyoutLabel({ pluginId: 'manju-studio', displayName: 'manju-studio' }),
    'manju-studio',
  );
  assert.equal(
    buyoutLabel({ pluginId: 'manju-studio', displayName: '漫剧工作室' }),
    '漫剧工作室 (manju-studio)',
  );
  assert.equal(
    buyoutLabel(
      { pluginId: 'manju-studio', displayName: 'manju-studio' },
      [{ manifestId: 'manju-studio', displayName: '漫剧工作室' }],
    ),
    '漫剧工作室 (manju-studio)',
  );
});

test('PKCE 等待为 5 分钟', () => {
  assert.equal(PKCE_WAIT_MS, 5 * 60 * 1000);
});
