import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  nativeImage,
  safeStorage,
  shell,
  webContents,
  type IpcMainInvokeEvent,
  type NativeImage,
} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CallServicePayload } from '../shared/dex-ipc.ts';
import type { GatewaySessionView, SpendBlockedPayload } from '../shared/dex-bridge.ts';
import { readAvailableMemory } from './available-memory.ts';
import { readExtraPluginPaths, readForceUpdateIcon, readGatewayBaseUrl } from './dev-config.ts';
import { GATEWAY_ENV_KEY, resolveGatewayBaseUrl } from './gateway-config.ts';
import { createFileSecureStore, GatewaySession, parseAuthCallback } from './gateway-session.ts';
import { createHostModels } from './host-egress.ts';
import { INSTALLED_PLUGINS_DIR_NAME, resolveHostDataPath } from './host-data.ts';
import { installPluginZip, uninstallInstalledPlugin } from './install.ts';
import { handleInvoke, onSend } from './ipc.ts';
import { LocalSession } from './local-session.ts';
import { isHttpUrl } from './manifest.ts';
import { pluginInstallPath, type PluginRelease } from './plugin-catalog.ts';
import { downloadVerifiedZip, fetchPluginCatalog, findRelease, installCatalogRelease } from './plugin-market.ts';
import { deleteOrigin, marketUpdates, readOrigins, writeOrigin } from './plugin-origins.ts';
import {
  createInstallLock,
  createPluginSilentUpdates,
  PLUGIN_SILENT_UPDATE_INTERVAL_MS,
  type PluginSilentUpdates,
  type SilentInstallResult,
} from './plugin-silent-update.ts';
import { exampleSettingIdsToDrop, PluginSettingsStore } from './plugin-settings.ts';
import { ensurePluginProtocol, pluginPartition, registerPluginScheme } from './protocol.ts';
import { ServiceRegistry } from './registry.ts';
import { applyUserSearchPath } from './shell-path.ts';
import type { DexResult } from './types.ts';
import { initUpdater } from './updater.ts';

registerPluginScheme();

const SHOP_FOCUS_REFRESH_MS = 2000;
let lastShopFocusRefreshAt = 0;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

const registry = new ServiceRegistry();
let localSession: LocalSession | null = null;
let gatewaySession: GatewaySession | null = null;
const installLock = createInstallLock();
let silentUpdates: PluginSilentUpdates | null = null;
let silentTimer: ReturnType<typeof setInterval> | null = null;
let reportedWatchingId: string | null = null;
let pendingAuthUrl: string | null = null;
let mainWindow: BrowserWindow | null = null;

function session(): LocalSession {
  if (!localSession) throw new Error('本地目录还没准备好');
  return localSession;
}

function bundledPluginsDir(): string {
  return path.join(app.getAppPath(), 'plugins');
}

function installedPluginsDir(): string {
  return path.join(app.getPath('userData'), INSTALLED_PLUGINS_DIR_NAME);
}

function pluginSettingsFile(): string {
  return path.join(app.getPath('userData'), 'plugin-settings.json');
}

function pluginOriginsFile(): string {
  return path.join(app.getPath('userData'), 'plugin-origins.json');
}

function recordFileOrigin(id: string): void {
  const plugin = registry.getPlugin(id);
  if (!plugin) return;
  writeOrigin(pluginOriginsFile(), id, {
    channel: 'file',
    version: plugin.manifest.version,
    installedAt: new Date().toISOString(),
  });
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
  return path.join(app.getAppPath(), 'dist/preload/plugin.cjs');
}

function hostPreloadFile(): string {
  return path.join(app.getAppPath(), 'dist/preload/host.cjs');
}

async function loadAllPlugins(): Promise<void> {
  const mounts = session();
  if (!app.isPackaged) {
    await registry.scanAndLoadPlugins(bundledPluginsDir(), 'bundled');
    const configPath = devConfigPath();
    await mounts.loadPaths(readExtraPluginPaths(configPath, registry.logger), 'config');
  }
  await mounts.loadRegistered();
  await registry.scanAndLoadPlugins(installedPluginsDir(), 'installed');
  dropStaleExampleSettings();
}

function installedPluginDirectoryIds(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const ids: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    // 覆盖安装的备份目录以点开头，不是已安装插件。
    if (name.startsWith('.')) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(dir, name));
    } catch {
      continue;
    }
    if (stat.isDirectory()) ids.push(name);
  }
  return ids;
}

function dropStaleExampleSettings(): void {
  const loaded = registry.getPluginList().map((plugin) => ({
    source: plugin.source,
    manifestId: plugin.manifestId,
  }));
  const ids = exampleSettingIdsToDrop({
    loaded,
    installedIds: installedPluginDirectoryIds(installedPluginsDir()),
  });
  for (const id of ids) {
    registry.deletePluginSettings(id);
  }
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }
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
      preload: hostPreloadFile(),
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // 等首帧画好再显示，避免标题栏占高前先露出贴顶的字标。
  win.once('ready-to-show', () => {
    win.show();
  });
  // 宿主页用 img 加载 app-plugin:// 图标。协议原先只挂在插件 partition 上，默认 session 也要有一份。
  ensurePluginProtocol(registry, '');
  win.webContents.once('did-finish-load', () => {
    startSilentPluginUpdates();
  });
  void win.loadFile(path.join(app.getAppPath(), 'src/renderer/index.html'));
}

function readCallPayload(payload: CallServicePayload): CallServicePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('调用参数无效');
  }
  if (typeof payload.serviceName !== 'string' || typeof payload.method !== 'string') {
    throw new Error('调用参数无效');
  }
  if (payload.args !== undefined && !Array.isArray(payload.args)) {
    throw new Error('参数 args 必须是数组');
  }
  return {
    serviceName: payload.serviceName,
    method: payload.method,
    args: Array.isArray(payload.args) ? payload.args : [],
  };
}

async function installFromZip(zipFilePath: string): Promise<DexResult> {
  if (!zipFilePath.toLowerCase().endsWith('.zip')) {
    return { ok: false, message: '请选择 .zip 插件包', plugins: registry.getPluginList() };
  }
  return installLock.run(async () => {
    try {
      const installed = await installPluginZip({
        registry,
        zipFilePath,
        userPluginsDir: installedPluginsDir(),
      });
      recordFileOrigin(installed.installedId);
      return { ok: true, plugins: installed.plugins, installedId: installed.installedId };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: registry.getPluginList(),
      };
    }
  });
}

function isIgnoredInstall(value: DexResult | { ignored: true }): value is { ignored: true } {
  return 'ignored' in value && value.ignored === true;
}

async function installKnownRelease(release: PluginRelease): Promise<SilentInstallResult> {
  const zipFilePath = path.join(os.tmpdir(), `dex-buddy-catalog-${process.pid}.zip`);
  try {
    await downloadVerifiedZip(release, zipFilePath);
    const installed = await installCatalogRelease({
      registry,
      release,
      zipFilePath,
      userPluginsDir: installedPluginsDir(),
    });
    writeOrigin(pluginOriginsFile(), installed.installedId, {
      channel: 'market',
      version: release.version,
      sha256: release.sha256,
      installedAt: new Date().toISOString(),
    });
    return { ok: true, plugins: installed.plugins, installedId: installed.installedId };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      plugins: registry.getPluginList(),
    };
  } finally {
    fs.rmSync(zipFilePath, { force: true });
  }
}

async function installCatalogById(id: string): Promise<DexResult> {
  try {
    const catalog = await fetchPluginCatalog();
    const release = findRelease(catalog, id);
    return installKnownRelease(release);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      plugins: registry.getPluginList(),
    };
  }
}

function startSilentPluginUpdates(): void {
  if (silentUpdates) {
    silentUpdates.setWatching(reportedWatchingId);
    // macOS 关掉窗口进程还在；再打开窗口时仍做一次启动检查。
    void silentUpdates.runRound();
    return;
  }
  silentUpdates = createPluginSilentUpdates({
    async fetchCatalog() {
      const catalog = await fetchPluginCatalog();
      return { plugins: catalog.plugins };
    },
    readInstalled() {
      return registry.getPluginList().map((plugin) => ({
        id: plugin.id,
        version: plugin.version,
        source: plugin.source,
      }));
    },
    readOrigins() {
      return readOrigins(pluginOriginsFile());
    },
    installRelease(release) {
      return installKnownRelease(release);
    },
    send(event) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('dex:plugin-silent-update', event);
      }
    },
  }, installLock);
  silentUpdates.setWatching(reportedWatchingId);
  void silentUpdates.runRound();
  silentTimer = setInterval(() => {
    void silentUpdates?.runRound();
  }, PLUGIN_SILENT_UPDATE_INTERVAL_MS);
}

function devConfigPath(): string {
  return path.join(app.getAppPath(), 'config.dev.json');
}

function gatewayRefreshFile(): string {
  return path.join(app.getPath('userData'), 'gateway-refresh.bin');
}

function broadcastSession(view: GatewaySessionView): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('dex:session', view);
  }
}

function broadcastSpendBlocked(payload: SpendBlockedPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('dex:spend-blocked', payload);
  }
}

function focusMainWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function registerDexbuddyProtocolClient(): void {
  // 未打包时必须带上入口脚本，否则系统只会唤起 Electron 本体。
  if (process.defaultApp) {
    const entry = path.resolve(process.argv[1] ?? '.');
    app.setAsDefaultProtocolClient('dexbuddy', process.execPath, [entry]);
    return;
  }
  app.setAsDefaultProtocolClient('dexbuddy');
}

function findAuthUrlInArgv(argv: string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && parseAuthCallback(arg)) return arg;
  }
  return null;
}

async function handleIncomingAuthUrl(rawUrl: string): Promise<void> {
  if (!gatewaySession) {
    pendingAuthUrl = rawUrl;
    return;
  }
  const ok = await gatewaySession.handleAuthUrl(rawUrl);
  focusMainWindow();
  if (!ok && parseAuthCallback(rawUrl)) {
    registry.logger.error('网关登录回调未能完成兑换，请重新点登录');
  }
}

function createGatewaySession(): GatewaySession {
  const configValue = app.isPackaged ? null : readGatewayBaseUrl(devConfigPath(), registry.logger);
  const baseUrl = resolveGatewayBaseUrl({
    envValue: process.env[GATEWAY_ENV_KEY],
    configValue,
    isPackaged: app.isPackaged,
  });
  const storePath = gatewayRefreshFile();
  const store = createFileSecureStore({
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (blob) => safeStorage.decryptString(blob),
    readFile: () => {
      try {
        if (!fs.existsSync(storePath)) return null;
        return fs.readFileSync(storePath);
      } catch {
        return null;
      }
    },
    writeFile: (blob) => {
      fs.writeFileSync(storePath, blob);
    },
    removeFile: () => {
      try {
        if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
      } catch {
        // 清不掉密文文件时仍清内存；下次启动会再试。
      }
    },
  });
  return new GatewaySession({
    baseUrl,
    fetch: globalThis.fetch.bind(globalThis),
    openExternal: async (url) => {
      await shell.openExternal(url);
    },
    store,
    onChange: broadcastSession,
  });
}

function sessionGateway(): GatewaySession {
  if (!gatewaySession) throw new Error('网关会话还没准备好');
  return gatewaySession;
}

function devFlags(): { forceUpdateIcon: boolean } {
  // 打包后固定关闭，避免安装包里的开发配置把下载图标留在界面上。
  if (app.isPackaged) return { forceUpdateIcon: false };
  return { forceUpdateIcon: readForceUpdateIcon(devConfigPath(), registry.logger) };
}

function registerIpc(): void {
  handleInvoke('dex:dev-flags', () => devFlags());

  handleInvoke('dex:list-plugins', () => registry.getPluginList());

  handleInvoke('dex:local-username', () => {
    // 读不到账户名时交回空字符串，界面再显示「本地用户」。
    try {
      const name = os.userInfo().username;
      return typeof name === 'string' ? name : '';
    } catch {
      return '';
    }
  });

  handleInvoke('dex:gateway-session', () => sessionGateway().view());
  handleInvoke('dex:gateway-login-pkce', () => sessionGateway().startPkce());
  handleInvoke('dex:gateway-login-device', () => sessionGateway().startDevice());
  handleInvoke('dex:gateway-login-cancel', () => sessionGateway().cancelLogin());
  handleInvoke('dex:gateway-submit-code', (_event, code) => sessionGateway().submitAuthCode(code));
  handleInvoke('dex:gateway-reopen-login', () => sessionGateway().reopenLogin());
  handleInvoke('dex:gateway-refresh', () => sessionGateway().refreshSummary());
  handleInvoke('dex:gateway-open-shop', () => sessionGateway().openShop());
  handleInvoke('dex:gateway-logout', () => sessionGateway().logout());

  handleInvoke('dex:prepare-plugin', (_event, id) => {
    if (!registry.getPlugin(id)) {
      throw new Error('插件不存在');
    }
    const partition = pluginPartition(id);
    ensurePluginProtocol(registry, partition);
    return {
      partition,
      preloadUrl: pathToFileURL(pluginPreloadFile()).href,
    };
  });

  handleInvoke('dex:available-memory', () => {
    return readAvailableMemory(process.platform, () => process.getSystemMemoryInfo());
  });

  handleInvoke('dex:set-view-throttling', (event, webContentsId, throttle) => {
    if (!Number.isInteger(webContentsId)) return;
    const target = webContents.fromId(webContentsId);
    if (!target || target.isDestroyed()) return;
    const host = target.hostWebContents;
    if (!host || host.id !== event.sender.id) return;
    const url = target.getURL();
    if (!url.startsWith('app-plugin://')) return;
    target.setBackgroundThrottling(throttle);
  });

  handleInvoke('dex:call-service', async (event, payload) => {
    const call = readCallPayload(payload);
    // 认不出 app-plugin 页面就拒绝。吞掉错误会让导航离开后的预加载仍能调全局服务。
    const callerId = pluginIdFromSender(event);
    return registry.callService(call.serviceName, call.method, call.args, callerId);
  });

  handleInvoke('dex:install-zip', async (_event, zipFilePath) => installFromZip(zipFilePath));

  handleInvoke('dex:pick-and-install', async () => {
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

  handleInvoke('dex:settings-catalog', () => registry.listSettingsViews());

  handleInvoke('dex:settings-save', (_event, payload) => {
    if (!payload || typeof payload.id !== 'string') return { ok: false, message: '插件 id 无效' };
    return registry.savePluginSettings(payload.id, payload.draft);
  });

  handleInvoke('dex:reveal-plugin-secret', (_event, payload) => {
    if (!payload || typeof payload.id !== 'string' || typeof payload.key !== 'string') {
      return { ok: false };
    }
    return registry.revealPluginSecret(payload.id, payload.key);
  });

  handleInvoke('dex:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择目录',
      properties: ['openDirectory'],
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked) return { cancelled: true };
    return { cancelled: false, path: picked };
  });

  handleInvoke('dex:plugin-settings-get', (event) => registry.settingsView(pluginIdFromSender(event)));

  handleInvoke('dex:plugin-settings-save', (event, draft) => {
    return registry.savePluginSettings(pluginIdFromSender(event), draft);
  });

  handleInvoke('dex:open-external', async (_event, url) => {
    if (!isHttpUrl(url)) return { ok: false };
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  handleInvoke('dex:copy-text', (_event, text) => {
    if (text === '') return { ok: false };
    clipboard.writeText(text);
    return { ok: true };
  });

  handleInvoke('dex:general-settings', () => {
    const userData = app.getPath('userData');
    return {
      version: app.getVersion(),
      userData: resolveHostDataPath('userData', userData) ?? '',
      installedPlugins: resolveHostDataPath('installedPlugins', userData) ?? '',
    };
  });

  handleInvoke('dex:open-host-data', async (_event, kind) => {
    const target = resolveHostDataPath(kind, app.getPath('userData'));
    if (!target) return { ok: false, message: '不能打开这个目录' };
    try {
      const error = await shell.openPath(target);
      if (error) return { ok: false, message: error };
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法打开目录';
      return { ok: false, message };
    }
  });

  handleInvoke('dex:open-plugin-folder', async (_event, rootPath) => {
    if (rootPath.trim() === '') return { ok: false };
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

  handleInvoke('dex:plugin-catalog', async () => {
    try {
      const catalog = await fetchPluginCatalog();
      const updates = marketUpdates({
        catalog: catalog.plugins,
        origins: readOrigins(pluginOriginsFile()),
        installed: registry.getPluginList().map((plugin) => ({
          id: plugin.id,
          version: plugin.version,
          source: plugin.source,
        })),
      });
      const plugins = catalog.plugins.map((plugin) => ({
        ...plugin,
        installPath: pluginInstallPath(installedPluginsDir(), plugin.id),
      }));
      return { ok: true, generatedAt: catalog.generatedAt, plugins, updates };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: [],
        updates: [],
      };
    }
  });

  onSend('dex:set-watching-plugin', (_event, id) => {
    reportedWatchingId = typeof id === 'string' && id.trim() !== '' ? id : null;
    silentUpdates?.setWatching(reportedWatchingId);
  });

  handleInvoke('dex:plugin-install-catalog', async (_event, id) => {
    const outcome = await installLock.tryRun(() => {
      silentUpdates?.noteManualInstall(id);
      return installCatalogById(id);
    });
    if (isIgnoredInstall(outcome)) {
      return { ok: false, ignored: true, plugins: registry.getPluginList() };
    }
    return outcome;
  });

  handleInvoke('dex:retry-plugin-runtime', async (_event, id) => {
    try {
      const message = await registry.retryRuntime(id);
      if (message) {
        return { ok: false, message, plugins: registry.getPluginList() };
      }
      return { ok: true, plugins: registry.getPluginList() };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: registry.getPluginList(),
      };
    }
  });

  handleInvoke('dex:uninstall', async (_event, id) => {
    silentUpdates?.cancel(id);
    return installLock.run(async () => {
      try {
        const plugins = await uninstallInstalledPlugin({
          registry,
          id,
          userPluginsDir: installedPluginsDir(),
        });
        deleteOrigin(pluginOriginsFile(), id);
        return { ok: true, plugins };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          plugins: registry.getPluginList(),
        };
      }
    });
  });

  handleInvoke('dex:load-unpacked-directory', async () => {
    const result = await dialog.showOpenDialog({
      title: '加载本地目录',
      properties: ['openDirectory'],
    });
    const picked = result.filePaths[0];
    if (result.canceled || !picked) {
      return { ok: false, cancelled: true, plugins: registry.getPluginList() };
    }
    return session().addDirectory(picked);
  });

  handleInvoke('dex:reload-unpacked', async (_event, id) => {
    try {
      const plugins = await session().reload(id);
      return { ok: true, plugins };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: registry.getPluginList(),
      };
    }
  });

  handleInvoke('dex:start-preview', async (_event, id) => {
    try {
      return await session().startPreview(id);
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: registry.getPluginList(),
      };
    }
  });

  handleInvoke('dex:end-preview', async (_event, id) => {
    try {
      const plugins = await session().endPreview(id);
      return { ok: true, plugins };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        plugins: registry.getPluginList(),
      };
    }
  });

  handleInvoke('dex:remove-unpacked', async (_event, id) => {
    try {
      const plugins = await session().remove(id);
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

if (gotSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const url = findAuthUrlInArgv(argv);
    if (url) void handleIncomingAuthUrl(url);
  });

  // macOS：协议唤起可能在 ready 之前到达。
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleIncomingAuthUrl(url);
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  // 从 Dock 打开时 PATH 里没有登录 shell 配好的 Homebrew 等命令。先补上，再让插件子进程继承。
  await applyUserSearchPath(process.env);
  registerDexbuddyProtocolClient();
  registry.setSettings(new PluginSettingsStore(pluginSettingsFile(), registry.logger));
  registry.setOriginLookup((id) => readOrigins(pluginOriginsFile())[id]?.channel);
  registry.setRuntimeHost({
    userData: app.getPath('userData'),
    onProgress: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('dex:runtime-progress', event);
      }
    },
  });
  localSession = new LocalSession({
    registry,
    userData: app.getPath('userData'),
    unpackedFile: path.join(app.getPath('userData'), 'unpacked-plugins.json'),
  });
  gatewaySession = createGatewaySession();
  registry.setHostModels((pluginId) =>
    createHostModels({
      pluginId,
      request: (path, init) => sessionGateway().authorizedJson(path, init),
      shopPluginIds: () => sessionGateway().shopPluginIds(),
      activeEntitlements: () => sessionGateway().activeEntitlements(),
      onBlocked: broadcastSpendBlocked,
    }),
  );
  const icon = loadAppIcon();
  applyDockIcon(icon);
  attachWebviewGuard();
  registerIpc();
  initUpdater();
  await loadAllPlugins();
  await gatewaySession.start();
  createWindow(icon);
  app.on('browser-window-focus', () => {
    if (!gatewaySession?.view().signedIn) return;
    const now = Date.now();
    if (now - lastShopFocusRefreshAt < SHOP_FOCUS_REFRESH_MS) return;
    lastShopFocusRefreshAt = now;
    void gatewaySession.refreshSummary();
  });
  const coldUrl = pendingAuthUrl ?? findAuthUrlInArgv(process.argv);
  pendingAuthUrl = null;
  if (coldUrl) void handleIncomingAuthUrl(coldUrl);
});

app.on('activate', () => {
  if (!gotSingleInstanceLock) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }
  createWindow(loadAppIcon());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (silentTimer) {
    clearInterval(silentTimer);
    silentTimer = null;
  }
});
