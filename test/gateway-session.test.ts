import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLoginUrl,
  createPkcePair,
  createFileSecureStore,
  formatBalanceLabel,
  GatewaySession,
  parseAuthCallback,
} from '../src/main/gateway-session.ts';
import { GATEWAY_REDIRECT_URI } from '../src/main/gateway-config.ts';

function memoryStore(available = true) {
  let blob: Buffer | null = null;
  let wrotePlain: string | null = null;
  return {
    store: createFileSecureStore({
      isAvailable: () => available,
      encryptString: (plain) => {
        wrotePlain = plain;
        return Buffer.from(`enc:${plain}`, 'utf8');
      },
      decryptString: (buf) => buf.toString('utf8').replace(/^enc:/, ''),
      readFile: () => blob,
      writeFile: (next) => {
        blob = next;
      },
      removeFile: () => {
        blob = null;
        wrotePlain = null;
      },
    }),
    getBlob: () => blob,
    getWrotePlain: () => wrotePlain,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('createPkcePair 与 buildLoginUrl 带 S256 三参数', () => {
  const pair = createPkcePair();
  assert.ok(pair.verifier.length >= 43);
  assert.ok(pair.challenge.length >= 43);
  const url = buildLoginUrl('http://localhost:3000', pair.challenge);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'http://localhost:3000');
  assert.equal(parsed.pathname, '/login');
  assert.equal(parsed.searchParams.get('code_challenge'), pair.challenge);
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('redirect_uri'), GATEWAY_REDIRECT_URI);
});

test('parseAuthCallback 只接受 dexbuddy://auth/callback 的 code', () => {
  assert.equal(parseAuthCallback('dexbuddy://auth/callback?code=abc'), 'abc');
  assert.equal(parseAuthCallback('dexbuddy:///auth/callback?code=xyz'), 'xyz');
  assert.equal(parseAuthCallback('https://example.com/callback?code=abc'), null);
  assert.equal(parseAuthCallback('dexbuddy://auth/callback'), null);
});

test('formatBalanceLabel 展示积分', () => {
  assert.equal(formatBalanceLabel(12, 'credits'), '12 积分');
  assert.equal(formatBalanceLabel(null, 'credits'), '积分未知');
});

test('PKCE exchange 成功后摘要不含 token，refresh 只进密文', async () => {
  const { store, getBlob, getWrotePlain } = memoryStore(true);
  const opened: string[] = [];
  const paths: string[] = [];
  const session = new GatewaySession({
    baseUrl: 'http://localhost:3000',
    openExternal: async (url) => {
      opened.push(url);
    },
    store,
    fetch: async (input, init) => {
      const url = String(input);
      paths.push(new URL(url).pathname);
      if (url.endsWith('/v1/auth/exchange')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string; codeVerifier?: string };
        assert.equal(body.code, 'auth-code');
        assert.ok(typeof body.codeVerifier === 'string' && body.codeVerifier.length > 0);
        return jsonResponse({
          ok: true,
          accessToken: 'dbh_at_test',
          refreshToken: 'dbh_rt_test',
          tokenType: 'Bearer',
          expiresIn: 900,
        });
      }
      if (url.endsWith('/v1/whoami')) {
        return jsonResponse({
          userId: '00000000-0000-0000-0000-000000000001',
          phoneMasked: '138****0000',
          accountKind: 'personal',
          wallet: { balance: '3.0000', currency: 'credits' },
          organizations: [],
        });
      }
      if (url.endsWith('/v1/wallet')) {
        return jsonResponse({ balance: '3.0000', currency: 'credits' });
      }
      return jsonResponse({ ok: false, code: 'SERVER_ERROR', error: 'unexpected' }, 500);
    },
  });

  const start = await session.startPkce();
  assert.equal(start.ok, true);
  assert.equal(opened.length, 1);
  assert.match(opened[0]!, /code_challenge=/);

  const exchanged = await session.submitAuthCode('auth-code');
  assert.equal(exchanged.ok, true);
  const view = session.view();
  assert.equal(view.signedIn, true);
  assert.equal(view.phoneMasked, '138****0000');
  assert.equal(view.balance, 3);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes('dbh_at_'), false);
  assert.equal(serialized.includes('dbh_rt_'), false);
  assert.ok(getBlob());
  assert.ok(getWrotePlain()?.includes('dbh_rt_test'));
  assert.equal(getWrotePlain()?.includes('dbh_at_'), false);
  assert.ok(paths.includes('/v1/auth/exchange'));
});

test('连点 startPkce 不换 verifier，第二次只再打开同一登录 URL', async () => {
  const { store } = memoryStore(true);
  const opened: string[] = [];
  let seenVerifier: string | null = null;
  const session = new GatewaySession({
    baseUrl: 'http://localhost:3000',
    openExternal: async (url) => {
      opened.push(url);
    },
    store,
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/auth/exchange')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string; codeVerifier?: string };
        if (seenVerifier === null) seenVerifier = body.codeVerifier ?? null;
        else assert.equal(body.codeVerifier, seenVerifier);
        return jsonResponse({
          ok: true,
          accessToken: 'dbh_at_double',
          refreshToken: 'dbh_rt_double',
          tokenType: 'Bearer',
          expiresIn: 900,
        });
      }
      if (url.endsWith('/v1/whoami')) {
        return jsonResponse({
          userId: '00000000-0000-0000-0000-000000000099',
          phoneMasked: '137****9999',
          accountKind: 'personal',
          wallet: { balance: '1.0000', currency: 'credits' },
          organizations: [],
        });
      }
      if (url.endsWith('/v1/wallet')) {
        return jsonResponse({ balance: '1.0000', currency: 'credits' });
      }
      return jsonResponse({ ok: false, code: 'SERVER_ERROR', error: 'unexpected' }, 500);
    },
  });

  const first = session.startPkce();
  const second = session.startPkce();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(opened.length, 2);
  assert.equal(opened[0], opened[1]);

  const ok = await session.handleAuthUrl('dexbuddy://auth/callback?code=auth-code');
  assert.equal(ok, true);
  assert.equal(session.view().signedIn, true);
  assert.ok(seenVerifier);
});

test('safeStorage 不可用时登录失败且不落盘', async () => {
  const { store, getBlob } = memoryStore(false);
  const session = new GatewaySession({
    baseUrl: 'http://localhost:3000',
    openExternal: async () => {},
    store,
    fetch: async () => jsonResponse({ ok: false, code: 'SERVER_ERROR', error: 'no' }, 500),
  });
  const result = await session.startPkce();
  assert.equal(result.ok, false);
  assert.match(result.message ?? '', /safeStorage|安全保存/);
  assert.equal(getBlob(), null);
  assert.equal(session.view().signedIn, false);
  assert.equal(session.view().login.phase, 'failed');
});

test('设备码 AUTHORIZATION_PENDING 后成功', async () => {
  const { store } = memoryStore(true);
  let exchangeCalls = 0;
  const session = new GatewaySession({
    baseUrl: 'http://localhost:3000',
    openExternal: async () => {},
    store,
    sleep: async () => {},
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/auth/device') {
        return jsonResponse({
          ok: true,
          deviceCode: 'dev-1',
          userCode: 'ABCD-EFGH',
          verificationUri: 'http://localhost:3000/device',
          verificationUriComplete: 'http://localhost:3000/device?user_code=ABCD-EFGH',
          expiresIn: 600,
          interval: 1,
        });
      }
      if (path === '/v1/auth/exchange') {
        exchangeCalls += 1;
        if (exchangeCalls === 1) {
          return jsonResponse(
            { ok: false, code: 'AUTHORIZATION_PENDING', error: 'pending' },
            400,
          );
        }
        return jsonResponse({
          ok: true,
          accessToken: 'dbh_at_device',
          refreshToken: 'dbh_rt_device',
          tokenType: 'Bearer',
          expiresIn: 900,
        });
      }
      if (path === '/v1/whoami') {
        return jsonResponse({
          userId: '00000000-0000-0000-0000-000000000002',
          phoneMasked: '139****1111',
          accountKind: 'personal',
          wallet: { balance: '0.0000', currency: 'credits' },
          organizations: [],
        });
      }
      if (path === '/v1/wallet') {
        return jsonResponse({ balance: '0.0000', currency: 'credits' });
      }
      return jsonResponse({ ok: false, code: 'SERVER_ERROR', error: 'unexpected' }, 500);
    },
  });

  const started = await session.startDevice();
  assert.equal(started.ok, true);
  assert.equal(session.view().login.userCode, 'ABCD-EFGH');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(session.view().signedIn, true);
  assert.equal(session.view().phoneMasked, '139****1111');
  assert.ok(exchangeCalls >= 2);
});

test('并发 refresh 只打一次网关', async () => {
  const { store } = memoryStore(true);
  store.writeBlob(
    store.encrypt(JSON.stringify({ v: 1, refreshToken: 'dbh_rt_old' })),
  );
  let refreshCalls = 0;
  let resolveRefresh: ((value: Response) => void) | null = null;
  const session = new GatewaySession({
    baseUrl: 'http://localhost:3000',
    openExternal: async () => {},
    store,
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/auth/refresh') {
        refreshCalls += 1;
        return await new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return jsonResponse({ ok: false, code: 'SERVER_ERROR', error: 'unexpected' }, 500);
    },
  });

  const first = session.refreshSerial();
  const second = session.refreshSerial();
  assert.equal(refreshCalls, 1);
  resolveRefresh!(
    jsonResponse({
      ok: true,
      accessToken: 'dbh_at_new',
      refreshToken: 'dbh_rt_new',
      tokenType: 'Bearer',
      expiresIn: 900,
    }),
  );
  await Promise.all([first, second]);
  assert.equal(refreshCalls, 1);
});

test('refresh 失败清空凭证', async () => {
  const { store, getBlob } = memoryStore(true);
  store.writeBlob(store.encrypt(JSON.stringify({ v: 1, refreshToken: 'dbh_rt_bad' })));
  const session = new GatewaySession({
    baseUrl: 'http://localhost:3000',
    openExternal: async () => {},
    store,
    fetch: async () =>
      jsonResponse({ ok: false, code: 'INVALID_GRANT', error: 'bad refresh' }, 401),
  });
  await assert.rejects(() => session.refreshSerial(), /bad refresh|INVALID_GRANT|未登录|网关/);
  assert.equal(getBlob(), null);
  assert.equal(session.view().signedIn, false);
});
