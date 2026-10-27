import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  UNPACKAGED_APP_NAME,
  UNPACKAGED_APP_USER_MODEL_ID,
  applyUnpackagedIdentity,
  unpackagedUserDataPath,
  type AppIdentityHost,
} from '../src/main/app-identity.ts';

test('未打包路径落到 Application Support 下的 Dex Buddy Dev', () => {
  assert.equal(UNPACKAGED_APP_NAME, 'Dex Buddy Dev');
  assert.equal(
    unpackagedUserDataPath('/Users/me/Library/Application Support'),
    path.join('/Users/me/Library/Application Support', 'Dex Buddy Dev'),
  );
});

function fakeHost(isPackaged: boolean): AppIdentityHost & {
  name: string | null;
  userData: string | null;
  appUserModelId: string | null;
} {
  const host = {
    isPackaged,
    name: null as string | null,
    userData: null as string | null,
    appUserModelId: null as string | null,
    setName(name: string) {
      host.name = name;
    },
    setPath(_name: 'userData', dir: string) {
      host.userData = dir;
    },
    getPath(_name: 'appData') {
      return '/Users/me/Library/Application Support';
    },
    setAppUserModelId(id: string) {
      host.appUserModelId = id;
    },
  };
  return host;
}

test('未打包时改名并分开 userData', () => {
  const host = fakeHost(false);
  applyUnpackagedIdentity(host, 'darwin');
  assert.equal(host.name, 'Dex Buddy Dev');
  assert.equal(host.userData, path.join('/Users/me/Library/Application Support', 'Dex Buddy Dev'));
  assert.equal(host.appUserModelId, null);
});

test('未打包在 Windows 上设置独立 AppUserModelId', () => {
  const host = fakeHost(false);
  applyUnpackagedIdentity(host, 'win32');
  assert.equal(host.appUserModelId, UNPACKAGED_APP_USER_MODEL_ID);
});

test('安装包不改名', () => {
  const host = fakeHost(true);
  applyUnpackagedIdentity(host, 'win32');
  assert.equal(host.name, null);
  assert.equal(host.userData, null);
  assert.equal(host.appUserModelId, null);
});
