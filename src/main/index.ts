import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readExtraPluginPaths } from './dev-config.ts';
import { installPluginZip, uninstallInstalledPlugin } from './install.ts';
import { ensurePluginProtocol, pluginPartition, registerPluginScheme } from './protocol.ts';
import { ServiceRegistry } from './registry.ts';
import type { HubResult } from './types.ts';

registerPluginScheme();

const registry = new ServiceRegistry();

function bundledPluginsDir(): string {
  return path.join(app.getAppPath(), 'plugins');
}

function installedPluginsDir(): string {
  return path.join(app.getPath('userData'), 'installed_plugins');
}

function pluginPreloadFile(): string {
  return path.join(app.getAppPath(), 'src/preload/plugin.cjs');
}

async function loadAllPlugins(): Promise<void> {
  await registry.scanAndLoadPlugins(bundledPluginsDir(), 'bundled');
  if (!app.isPackaged) {
    const configPath = path.join(app.getAppPath(), 'config.dev.json');
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'Huyuan AI 工作台 Hub',
    backgroundColor: '#f3efe7',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      preload: path.join(app.getAppPath(), 'src/preload/host.cjs'),
    },
  });

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

async function installFromZip(zipFilePath: string): Promise<HubResult> {
  if (!zipFilePath.toLowerCase().endsWith('.zip')) {
    return { ok: false, message: '请选择 .zip 插件包', plugins: registry.getPluginList() };
  }
  try {
    const plugins = await installPluginZip({
      registry,
      zipFilePath,
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
}

function registerIpc(): void {
  ipcMain.handle('hub:list-plugins', () => registry.getPluginList());

  ipcMain.handle('hub:prepare-plugin', (_event, id: unknown) => {
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

  ipcMain.handle('hub:call-service', async (_event, payload: unknown) => {
    const call = readCallPayload(payload);
    return registry.callService(call.serviceName, call.method, call.args);
  });

  ipcMain.handle('hub:install-zip', async (_event, zipFilePath: unknown) => {
    if (typeof zipFilePath !== 'string') {
      return { ok: false, message: '请选择 .zip 插件包', plugins: registry.getPluginList() };
    }
    return installFromZip(zipFilePath);
  });

  ipcMain.handle('hub:pick-and-install', async () => {
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

  ipcMain.handle('hub:uninstall', async (_event, id: unknown) => {
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
  attachWebviewGuard();
  registerIpc();
  await loadAllPlugins();
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
