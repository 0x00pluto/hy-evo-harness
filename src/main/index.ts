import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, type IpcMainInvokeEvent, type NativeImage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readExtraPluginPaths, readForceUpdateIcon } from './dev-config.ts';
import { installPluginZip, uninstallInstalledPlugin } from './install.ts';
import { isHttpUrl } from './manifest.ts';
import { PluginSettingsStore } from './plugin-settings.ts';
import { ensurePluginProtocol, pluginPartition, registerPluginScheme } from './protocol.ts';
import { ServiceRegistry } from './registry.ts';
import type { DexResult } from './types.ts';
import { initUpdater } from './updater.ts';

registerPluginScheme();

const registry = new ServiceRegistry();

function bundledPluginsDir(): string {
  return path.join(app.getAppPath(), 'plugins');
}

function installedPluginsDir(): string {
  return path.join(app.getPath('userData'), 'installed_plugins');
}

function pluginSettingsFile(): string {
  return path.join(app.getPath('userData'), 'plugin-settings.json');
}

function pluginIdFromSender(event: IpcMainInvokeEvent): string {
  const frameUrl = event.senderFrame?.url;
  const url = typeof frameUrl === 'string' && frameUrl.length > 0 ? frameUrl : event.sender.getURL();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('无法识别插件页面');
  }
  if (parsed.protocol !== 'app-plugin:') {
    throw new Error('无法识别插件页面');
  }
  const id = parsed.hostname;
  if (!registry.getPlugin(id)) {
    throw new Error('插件不存在');
  }
  return id;
}

function pluginPreloadFile(): string {
  return path.join(app.getAppPath(), 'src/preload/plugin.cjs');
}

async function loadAllPlugins(): Promise<void> {
  await registry.scanAndLoadPlugins(bundledPluginsDir(), 'bundled');
  if (!app.isPackaged) {
    const configPath = devConfigPath();
    for (const extra of readExtraPluginPaths(configPath, registry.logger)) {
      await registry.scanAndLoadPlugins(extra, 'dev');
    }
  }
  await registry.scanAndLoadPlugins(installedPluginsDir(), 'installed');
}

function attachWebviewGuard(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : '';
      if (!src.startsWith('app-plugin://')) {
        event.preventDefault();
        return;
      }

      let pluginId = '';
      try {
        pluginId = new URL(src).hostname;
      } catch {
        event.preventDefault();
        return;
      }
      if (!registry.getPlugin(pluginId)) {
        event.preventDefault();
        return;
      }

      const partition = pluginPartition(pluginId);
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.partition = partition;
      webPreferences.preload = pluginPreloadFile();
      ensurePluginProtocol(registry, partition);
    });
  });
}

function loadAppIcon(): NativeImage | null {
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');
  if (!fs.existsSync(iconPath)) return null;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? null : image;
}

function applyDockIcon(icon: NativeImage | null): void {
  // 未打包时进程是 Electron 本体，程序坞会一直显示原子图标。
  if (!icon || process.platform !== 'darwin') return;
  app.dock?.setIcon(icon);
}

function createWindow(icon: NativeImage | null): void {
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Dex Buddy',
    show: false,
    backgroundColor: '#ffffff',
    ...(icon && !mac ? { icon } : {}),
    ...(mac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 10 },
        }
      : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      preload: path.join(app.getAppPath(), 'src/preload/host.cjs'),
    },
  });

  // 等首帧画好再显示，避免标题栏占高前先露出贴顶的字标。
  win.once('ready-to-show', () => {
    win.show();
  });
  // 宿主页用 img 加载 app-plugin:// 图标。协议原先只挂在插件 partition 上，默认 session 也要有一份。
  ensurePluginProtocol(registry, '');
  void win.loadFile(path.join(app.getAppPath(), 'src/renderer/index.html'));
}

function readCallPayload(payload: unknown): { serviceName: string; method: string; args: unknown[] } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('调用参数无效');
  }
  const raw = payload as Record<string, unknown>;
  if (typeof raw.serviceName !== 'string' || typeof raw.method !== 'string') {
    throw new Error('调用参数无效');
  }
  if (raw.args !== undefined && !Array.isArray(raw.args)) {
    throw new Error('参数 args 必须是数组');
  }
  return {
    serviceName: raw.serviceName,
    method: raw.method,
    args: Array.isArray(raw.args) ? raw.args : [],
  };
}

async function installFromZip(zipFilePath: string): Promise<DexResult> {
  if (!zipFilePath.toLowerCase().endsWith('.zip')) {
    return { ok: false, message: '请选择 .zip 插件包', plugins: registry.getPluginList() };
  }
  try {
    const installed = await installPluginZip({
      registry,
      zipFilePath,
      userPluginsDir: installedPluginsDir(),
    });
    return { ok: true, plugins: installed.plugins, installedId: installed.installedId };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      plugins: registry.getPluginList(),
    };
  }
}

function devConfigPath(): string {
  return path.join(app.getAppPath(), 'config.dev.json');
}

function devFlags(): { forceUpdateIcon: boolean } {
  // 打包后固定关闭，避免安装包里的开发配置把下载图标留在界面上。
  if (app.isPackaged) return { forceUpdateIcon: false };
  return { forceUpdateIcon: readForceUpdateIcon(devConfigPath(), registry.logger) };
}

function registerIpc(): void {
  ipcMain.handle('dex:dev-flags', () => devFlags());

  ipcMain.handle('dex:list-plugins', () => registry.getPluginList());

  ipcMain.handle('dex:local-username', () => {
    // 读不到账户名时交回空字符串，界面再显示「本地用户」。
    try {
      const name = os.userInfo().username;
      return typeof name === 'string' ? name : '';
    } catch {
      return '';
    }
  });

  ipcMain.handle('dex:prepare-plugin', (_event, id: unknown) => {
    if (typeof id !== 'string' || !registry.getPlugin(id)) {
      throw new Error('插件不存在');
    }
    const partition = pluginPartition(id);
    ensurePluginProtocol(registry, partition);
    return {
      partition,
      preloadUrl: pathToFileURL(pluginPreloadFile()).href,
    };
  });

  ipcMain.handle('dex:call-service', async (_event, payload: unknown) => {
    const call = readCallPayload(payload);
    return registry.callService(call.serviceName, call.method, call.args);
  });

  ipcMain.handle('dex:install-zip', async (_event, zipFilePath: unknown) => {
    if (typeof zipFilePath !== 'string') {
      return { ok: false, message: '请选择 .zip 插件包', plugins: registry.getPluginList() };
    }
    return installFromZip(zipFilePath);
  });

  ipcMain.handle('dex:pick-and-install', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择插件压缩包',
      properties: ['openFile'],
      filters: [{ name: '插件包', extensions: ['zip'] }],
    });
    const zipFilePath = result.filePaths[0];
    if (result.canceled || !zipFilePath) {
      return { ok: false, cancelled: true, plugins: registry.getPluginList() };
    }
    return installFromZip(zipFilePath);
  });

  ipcMain.handle('dex:settings-catalog', () => registry.listSettingsViews());

  ipcMain.handle('dex:settings-save', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return { ok: false, message: '配置无效' };
    const raw = payload as { id?: unknown; draft?: unknown };
    if (typeof raw.id !== 'string') return { ok: false, message: '插件 id 无效' };
    return registry.savePluginSettings(raw.id, raw.draft);
  });

  ipcMain.handle('dex:reveal-plugin-secret', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return { ok: false };
    const raw = payload as { id?: unknown; key?: unknown };
    if (typeof raw.id !== 'string' || typeof raw.key !== 'string') return { ok: false };
    return registry.revealPluginSecret(raw.id, raw.key);
  });

  ipcMain.handle('dex:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择目录',
      properties: ['openDirectory'],
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked) return { cancelled: true };
    return { cancelled: false, path: picked };
  });

  ipcMain.handle('dex:plugin-settings-get', (event) => registry.settingsView(pluginIdFromSender(event)));

  ipcMain.handle('dex:plugin-settings-save', (event, draft: unknown) => {
    return registry.savePluginSettings(pluginIdFromSender(event), draft);
  });

  ipcMain.handle('dex:open-external', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !isHttpUrl(url)) return { ok: false };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('dex:open-plugin-folder', async (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.trim() === '') return { ok: false };
    const target = path.resolve(rootPath);
    const known = registry.getPluginList().some((plugin) => path.resolve(plugin.rootPath) === target);
    if (!known) return { ok: false };
    try {
      const error = await shell.openPath(target);
      return { ok: error === '' };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('dex:uninstall', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
      return { ok: false, message: '插件 id 无效', plugins: registry.getPluginList() };
    }
    try {
      const plugins = await uninstallInstalledPlugin({
        registry,
        id,
        userPluginsDir: installedPluginsDir(),
      });
      return { ok: true, plugins };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: registry.getPluginList(),
      };
    }
  });
}

app.whenReady().then(async () => {
  registry.setSettings(new PluginSettingsStore(pluginSettingsFile(), registry.logger));
  const icon = loadAppIcon();
  applyDockIcon(icon);
  attachWebviewGuard();
  registerIpc();
  initUpdater();
  await loadAllPlugins();
  createWindow(icon);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(loadAppIcon());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
