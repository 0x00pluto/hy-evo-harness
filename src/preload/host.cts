import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DexHost } from '../shared/dex-bridge.ts';
import type { DexInvokeMap, DexPushMap, DexSendMap } from '../shared/dex-ipc.ts';

function invoke<C extends keyof DexInvokeMap>(
  channel: C,
  ...args: DexInvokeMap[C]['args']
): Promise<DexInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<DexInvokeMap[C]['result']>;
}

function send<C extends keyof DexSendMap>(channel: C, ...args: DexSendMap[C]): void {
  ipcRenderer.send(channel, ...args);
}

function onPush<C extends keyof DexPushMap>(
  channel: C,
  callback: (payload: DexPushMap[C]) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: DexPushMap[C]) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const dex: DexHost = {
  devFlags() {
    return invoke('dex:dev-flags');
  },
  listPlugins() {
    return invoke('dex:list-plugins');
  },
  localUsername() {
    return invoke('dex:local-username');
  },
  preparePlugin(id) {
    return invoke('dex:prepare-plugin', id);
  },
  availableMemory() {
    return invoke('dex:available-memory');
  },
  setViewThrottling(webContentsId, throttle) {
    return invoke('dex:set-view-throttling', webContentsId, throttle);
  },
  installZip(zipFilePath) {
    return invoke('dex:install-zip', zipFilePath);
  },
  pickAndInstall() {
    return invoke('dex:pick-and-install');
  },
  uninstall(id) {
    return invoke('dex:uninstall', id);
  },
  loadUnpackedDirectory() {
    return invoke('dex:load-unpacked-directory');
  },
  reloadUnpacked(id) {
    return invoke('dex:reload-unpacked', id);
  },
  reloadBundled(id) {
    return invoke('dex:reload-bundled', id);
  },
  startPreview(id) {
    return invoke('dex:start-preview', id);
  },
  endPreview(id) {
    return invoke('dex:end-preview', id);
  },
  removeUnpacked(id) {
    return invoke('dex:remove-unpacked', id);
  },
  retryPluginRuntime(id) {
    return invoke('dex:retry-plugin-runtime', id);
  },
  onRuntimeProgress(callback) {
    return onPush('dex:runtime-progress', callback);
  },
  pluginCatalog() {
    return invoke('dex:plugin-catalog');
  },
  installCatalogPlugin(id) {
    return invoke('dex:plugin-install-catalog', id);
  },
  setWatchingPlugin(id) {
    send('dex:set-watching-plugin', id);
  },
  onPluginSilentUpdate(callback) {
    return onPush('dex:plugin-silent-update', callback);
  },
  settingsCatalog() {
    return invoke('dex:settings-catalog');
  },
  savePluginSettings(id, draft) {
    return invoke('dex:settings-save', { id, draft });
  },
  revealPluginSecret(id, key) {
    return invoke('dex:reveal-plugin-secret', { id, key });
  },
  pickDirectory() {
    return invoke('dex:pick-directory');
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file as File);
  },
  openExternal(url) {
    return invoke('dex:open-external', url);
  },
  openPluginFolder(rootPath) {
    return invoke('dex:open-plugin-folder', rootPath);
  },
  generalSettings() {
    return invoke('dex:general-settings');
  },
  copyText(text) {
    return invoke('dex:copy-text', text);
  },
  openHostData(kind) {
    return invoke('dex:open-host-data', kind);
  },
  getUpdateStatus() {
    return invoke('updater:get-status');
  },
  onUpdateStatus(callback) {
    return onPush('updater:status', callback);
  },
  retryUpdateCheck() {
    return invoke('updater:retry');
  },
  installUpdate() {
    return invoke('updater:install');
  },
  gatewaySession() {
    return invoke('dex:gateway-session');
  },
  startGatewayLogin() {
    return invoke('dex:gateway-login-pkce');
  },
  startGatewayDeviceLogin() {
    return invoke('dex:gateway-login-device');
  },
  cancelGatewayLogin() {
    return invoke('dex:gateway-login-cancel');
  },
  submitGatewayAuthCode(code) {
    return invoke('dex:gateway-submit-code', code);
  },
  reopenGatewayLogin() {
    return invoke('dex:gateway-reopen-login');
  },
  refreshGatewaySession() {
    return invoke('dex:gateway-refresh');
  },
  openGatewayShop() {
    return invoke('dex:gateway-open-shop');
  },
  logoutGateway() {
    return invoke('dex:gateway-logout');
  },
  onGatewaySession(callback) {
    return onPush('dex:session', callback);
  },
  onSpendBlocked(callback) {
    return onPush('dex:spend-blocked', callback);
  },
};

contextBridge.exposeInMainWorld('dex', dex);
