import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GatewayError,
  parseCreditsBalance,
  parseEntitlements,
  parseModelsList,
  parseShopCatalog,
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

test('parseEntitlements / parseModelsList / parseShopCatalog', () => {
  assert.deepEqual(
    parseEntitlements({
      entitlements: [
        { pluginId: 'ai-comic-master', status: 'active' },
        { pluginId: 'gone', status: 'revoked' },
      ],
    }),
    {
      entitlements: [
        { pluginId: 'ai-comic-master', status: 'active' },
        { pluginId: 'gone', status: 'revoked' },
      ],
    },
  );
  const models = parseModelsList({
    object: 'list',
    data: [{ id: 'dexbuddy-chat', object: 'model', kind: 'chat', display_name: '文案' }],
  });
  assert.equal(models.data[0]?.id, 'dexbuddy-chat');
  const shop = parseShopCatalog({
    ok: true,
    catalog: {
      plugins: [{ pluginId: 'ai-comic-master', name: 'AI 漫画大师' }],
      ownedPluginIds: ['ai-comic-master'],
    },
  });
  assert.equal(shop.plugins[0]?.name, 'AI 漫画大师');
  assert.deepEqual(shop.ownedPluginIds, ['ai-comic-master']);
  const titled = parseShopCatalog({
    catalog: {
      plugins: [{ pluginId: 'manju-studio', displayName: '漫剧工作室' }],
    },
  });
  assert.equal(titled.plugins[0]?.name, '漫剧工作室');
});
