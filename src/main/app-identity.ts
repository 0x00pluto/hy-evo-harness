import path from 'node:path';

/** 未打包进程的应用名。安装包仍用 electron-builder 的 productName「Dex Buddy」。 */
export const UNPACKAGED_APP_NAME = 'Dex Buddy Dev';

/** 未打包 Windows 任务栏身份，避免和安装包并成一个图标。 */
export const UNPACKAGED_APP_USER_MODEL_ID = 'com.huyuan.dexbuddy.dev';

export function unpackagedUserDataPath(appData: string): string {
  return path.join(appData, UNPACKAGED_APP_NAME);
}

export interface AppIdentityHost {
  isPackaged: boolean;
  setName: (name: string) => void;
  setPath: (name: 'userData', dir: string) => void;
  getPath: (name: 'appData') => string;
  setAppUserModelId?: (id: string) => void;
}

/** 必须在 requestSingleInstanceLock 之前调用。安装包不改名。 */
export function applyUnpackagedIdentity(
  host: AppIdentityHost,
  platform: NodeJS.Platform = process.platform,
): void {
  if (host.isPackaged) return;
  host.setName(UNPACKAGED_APP_NAME);
  host.setPath('userData', unpackagedUserDataPath(host.getPath('appData')));
  if (platform === 'win32') {
    host.setAppUserModelId?.(UNPACKAGED_APP_USER_MODEL_ID);
  }
}
