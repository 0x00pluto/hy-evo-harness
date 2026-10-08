import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { UpdateInfo } from 'electron-updater';
import { extractMacDmgInfo, macDmgFileName } from './update-assets.ts';

// electron-updater 是 CommonJS，autoUpdater 用 getter 挂上，ESM 命名导入会在启动时失败。
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SILENT_RETRY_DELAY_MS = 5_000;

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'downloading'
  | 'readyToInstall'
  | 'installing'
  | 'error';

export type PlatformFlow = 'win-auto' | 'mac-dmg';

export interface UpdaterStatusPayload {
  status: UpdateStatus;
  platformFlow: PlatformFlow;
  currentVersion: string;
  availableVersion?: string;
  errorMessage?: string;
  lastCheckedAt?: string;
}

export interface InstallUpdateResult {
  ok: boolean;
  blockedByTask?: boolean;
}

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const platformFlow: PlatformFlow = isWin ? 'win-auto' : 'mac-dmg';

let checkTimer: ReturnType<typeof setInterval> | null = null;
let silentRetryUsed = false;
let pendingUpdateInfo: UpdateInfo | null = null;
let macDmgUrl: string | null = null;
let macDmgExpectedSize: number | null = null;
let macDownloadInProgress = false;

function createInitialPayload(): UpdaterStatusPayload {
  return {
    status: 'idle',
    platformFlow,
    currentVersion: app.getVersion(),
  };
}

let currentPayload: UpdaterStatusPayload = createInitialPayload();

function shouldSkipScheduledCheck(): boolean {
  return ['downloading', 'readyToInstall', 'installing'].includes(currentPayload.status);
}

function broadcastStatus(): void {
  const snapshot = { ...currentPayload };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:status', snapshot);
    }
  }
}

function setPayload(partial: Partial<UpdaterStatusPayload>): void {
  currentPayload = { ...currentPayload, ...partial };
  broadcastStatus();
}

function resetErrorState(): void {
  silentRetryUsed = false;
  if (currentPayload.status === 'error') {
    setPayload({ status: 'idle', errorMessage: undefined });
  }
}

function getMacDmgLocalPath(version: string): string {
  return path.join(app.getPath('downloads'), macDmgFileName(version));
}

function isMacDmgReady(version: string): boolean {
  const localPath = getMacDmgLocalPath(version);
  if (!existsSync(localPath)) return false;
  if (macDmgExpectedSize == null) return true;
  try {
    return statSync(localPath).size === macDmgExpectedSize;
  } catch {
    return false;
  }
}

function removePartialDownload(localPath: string): void {
  try {
    if (existsSync(localPath)) unlinkSync(localPath);
  } catch {
    // 残留文件留到下次按大小校验；删不掉不阻断错误上报
  }
}

function scheduleSilentRetry(reason: string): void {
  if (silentRetryUsed) {
    setPayload({
      status: 'error',
      errorMessage: reason,
    });
    return;
  }

  silentRetryUsed = true;
  setTimeout(() => {
    if (!shouldSkipScheduledCheck()) {
      void runCheck();
    }
  }, SILENT_RETRY_DELAY_MS);
}

async function runCheck(): Promise<void> {
  if (!app.isPackaged) return;
  if (!isWin && !isMac) return;
  if (shouldSkipScheduledCheck()) return;

  resetErrorState();
  setPayload({ status: 'checking' });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : '检查更新失败';
    scheduleSilentRetry(message);
  }
}

function downloadMacDmg(version: string, url: string): Promise<void> {
  const localPath = getMacDmgLocalPath(version);

  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on('response', (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`下载 dmg 失败（HTTP ${response.statusCode}）`));
        return;
      }

      const fileStream = createWriteStream(localPath);
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        fileStream.destroy();
        removePartialDownload(localPath);
        reject(error);
      };

      fileStream.on('finish', () => {
        if (settled) return;
        settled = true;
        if (macDmgExpectedSize != null) {
          try {
            if (statSync(localPath).size !== macDmgExpectedSize) {
              removePartialDownload(localPath);
              reject(new Error('下载的 dmg 大小与发布信息不一致'));
              return;
            }
          } catch (error) {
            reject(error instanceof Error ? error : new Error('无法校验 dmg'));
            return;
          }
        }
        resolve();
      });
      fileStream.on('error', fail);

      response.on('data', (chunk) => {
        fileStream.write(chunk);
      });
      response.on('end', () => {
        fileStream.end();
      });
      response.on('error', fail);
    });
    request.on('error', (error) => {
      removePartialDownload(localPath);
      reject(error);
    });
    request.end();
  });
}

async function openMacDmg(version: string): Promise<void> {
  const localPath = getMacDmgLocalPath(version);
  setPayload({ status: 'installing', availableVersion: version });

  const openResult = await shell.openPath(localPath);
  if (openResult) {
    throw new Error(openResult);
  }

  setPayload({ status: 'readyToInstall', availableVersion: version, errorMessage: undefined });
}

async function installMacUpdate(): Promise<InstallUpdateResult> {
  const version = currentPayload.availableVersion ?? pendingUpdateInfo?.version;
  if (!version) {
    setPayload({ status: 'error', errorMessage: '未找到可下载的版本信息' });
    return { ok: false };
  }

  if (isMacDmgReady(version)) {
    try {
      await openMacDmg(version);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开 dmg 失败';
      setPayload({ status: 'error', errorMessage: message });
      return { ok: false };
    }
  }

  const url = macDmgUrl ?? extractMacDmgInfo(pendingUpdateInfo ?? { version, files: [] }).url;
  if (!url) {
    setPayload({ status: 'error', errorMessage: '未找到 dmg 下载地址' });
    return { ok: false };
  }

  if (macDownloadInProgress) {
    return { ok: false };
  }

  macDownloadInProgress = true;
  setPayload({ status: 'downloading', availableVersion: version, errorMessage: undefined });

  try {
    await downloadMacDmg(version, url);
    macDownloadInProgress = false;
    await openMacDmg(version);
    return { ok: true };
  } catch (error) {
    macDownloadInProgress = false;
    const message = error instanceof Error ? error.message : '下载 dmg 失败';
    setPayload({ status: 'error', errorMessage: message });
    return { ok: false };
  }
}

function installWinUpdate(): InstallUpdateResult {
  if (hasRunningTask()) {
    return { ok: false, blockedByTask: true };
  }

  setPayload({ status: 'installing' });
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
}

export function hasRunningTask(): boolean {
  // 任务状态落地前始终返回 false，避免以后改 IPC 形状
  return false;
}

function registerAutoUpdaterEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    setPayload({ status: 'checking', lastCheckedAt: new Date().toISOString() });
  });

  autoUpdater.on('update-not-available', () => {
    silentRetryUsed = false;
    setPayload({
      status: 'upToDate',
      availableVersion: undefined,
      errorMessage: undefined,
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on('update-available', (info) => {
    silentRetryUsed = false;
    pendingUpdateInfo = info;

    if (isWin) {
      setPayload({
        status: 'downloading',
        availableVersion: info.version,
        errorMessage: undefined,
        lastCheckedAt: new Date().toISOString(),
      });
      return;
    }

    if (isMac) {
      const dmgInfo = extractMacDmgInfo(info);
      macDmgUrl = dmgInfo.url;
      macDmgExpectedSize = dmgInfo.size;
      setPayload({
        status: 'readyToInstall',
        availableVersion: info.version,
        errorMessage: undefined,
        lastCheckedAt: new Date().toISOString(),
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    silentRetryUsed = false;
    pendingUpdateInfo = info;
    setPayload({
      status: 'readyToInstall',
      availableVersion: info.version,
      errorMessage: undefined,
    });
  });

  autoUpdater.on('error', (error) => {
    const message = error.message || '更新失败';
    scheduleSilentRetry(message);
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('updater:get-status', () => ({ ...currentPayload }));

  ipcMain.handle('updater:retry', async () => {
    silentRetryUsed = false;
    setPayload({ status: 'idle', errorMessage: undefined });
    await runCheck();
  });

  ipcMain.handle('updater:install', async (): Promise<InstallUpdateResult> => {
    if (isWin) return installWinUpdate();
    if (isMac) return installMacUpdate();
    return { ok: false };
  });
}

function publishStatusWhenWindowLoads(): void {
  app.on('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed()) {
        window.webContents.send('updater:status', { ...currentPayload });
      }
    });
  });
}

export function initUpdater(): void {
  currentPayload = createInitialPayload();
  registerIpcHandlers();
  publishStatusWhenWindowLoads();

  if (!app.isPackaged || (!isWin && !isMac)) {
    return;
  }

  autoUpdater.autoDownload = isWin;
  autoUpdater.autoInstallOnAppQuit = isWin;
  autoUpdater.allowPrerelease = false;

  registerAutoUpdaterEvents();
  void runCheck();

  checkTimer = setInterval(() => {
    void runCheck();
  }, CHECK_INTERVAL_MS);

  app.on('before-quit', () => {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  });
}
