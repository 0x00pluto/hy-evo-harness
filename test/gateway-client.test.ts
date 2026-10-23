import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GatewayError,
  parseCreditsBalance,
  parseWallet,
  parseWhoami,
} from '../src/main/gateway-client.ts';

test('parseCreditsBalance 接受四位小数字符串与有限 number', () => {
  assert.equal(parseCreditsBalance('0.0000'), 0);
  assert.equal(parseCreditsBalance('12.3456'), 12.3456);
  assert.equal(parseCreditsBalance(3), 3);
  assert.equal(parseCreditsBalance(' 1.5 '), 1.5);
});

test('parseCreditsBalance 拒绝非法余额', () => {
  assert.throws(() => parseCreditsBalance(''), GatewayError);
  assert.throws(() => parseCreditsBalance('abc'), GatewayError);
  assert.throws(() => parseCreditsBalance(Number.NaN), GatewayError);
  assert.throws(() => parseCreditsBalance(null), GatewayError);
  assert.throws(() => parseCreditsBalance(undefined), GatewayError);
});

test('parseWhoami / parseWallet 接受字符串余额', () => {
  const whoami = parseWhoami({
    userId: '00000000-0000-0000-0000-000000000001',
    phoneMasked: '138****0000',
    accountKind: 'personal',
    wallet: { balance: '3.0000', currency: 'credits' },
    organizations: [],
  });
  assert.equal(whoami.wallet.balance, 3);
  assert.equal(whoami.wallet.currency, 'credits');

  const wallet = parseWallet({ balance: '0.0000', currency: 'credits' });
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.currency, 'credits');
});

test('parseWhoami / parseWallet 在余额非法时抛 BAD_RESPONSE', () => {
  assert.throws(
    () =>
      parseWhoami({
        userId: '00000000-0000-0000-0000-000000000001',
        wallet: { balance: 'abc', currency: 'credits' },
      }),
    (err: unknown) => err instanceof GatewayError && err.message.includes('whoami.wallet'),
  );
  assert.throws(
    () => parseWallet({ balance: 'abc', currency: 'credits' }),
    (err: unknown) => err instanceof GatewayError && err.message.includes('wallet'),
  );
});
