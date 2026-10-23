import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEV_DEFAULT_GATEWAY_BASE_URL,
  PROD_DEFAULT_GATEWAY_BASE_URL,
  normalizeGatewayBaseUrl,
  resolveGatewayBaseUrl,
} from '../src/main/gateway-config.ts';

test('normalizeGatewayBaseUrl 去掉尾斜杠并拒绝非 http(s)', () => {
  assert.equal(normalizeGatewayBaseUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(normalizeGatewayBaseUrl('https://app.example.com/v1/'), 'https://app.example.com/v1');
  assert.equal(normalizeGatewayBaseUrl('ftp://x'), null);
  assert.equal(normalizeGatewayBaseUrl(''), null);
  assert.equal(normalizeGatewayBaseUrl('http://user:pass@host'), null);
});

test('resolveGatewayBaseUrl：环境变量优先于开发配置与默认值', () => {
  assert.equal(
    resolveGatewayBaseUrl({
      envValue: 'https://env.example.com/',
      configValue: 'http://localhost:3000',
      isPackaged: false,
    }),
    'https://env.example.com',
  );
  assert.equal(
    resolveGatewayBaseUrl({
      envValue: '',
      configValue: 'http://127.0.0.1:4000',
      isPackaged: true,
    }),
    'http://127.0.0.1:4000',
  );
  assert.equal(
    resolveGatewayBaseUrl({ envValue: null, configValue: null, isPackaged: false }),
    DEV_DEFAULT_GATEWAY_BASE_URL,
  );
  assert.equal(
    resolveGatewayBaseUrl({ envValue: undefined, configValue: undefined, isPackaged: true }),
    PROD_DEFAULT_GATEWAY_BASE_URL,
  );
});
