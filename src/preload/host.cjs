const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dex', {
  devFlags() {
    return ipcRenderer.invoke('dex:dev-flags');
  },
  listPlugins() {
    return ipcRenderer.invoke('dex:list-plugins');
  },
  localUsername() {
    return ipcRenderer.invoke('dex:local-username');
  },
  preparePlugin(id) {
    return ipcRenderer.invoke('dex:prepare-plugin', id);
  },
  installZip(zipFilePath) {
    return ipcRenderer.invoke('dex:install-zip', zipFilePath);
  },
  pickAndInstall() {
    return ipcRenderer.invoke('dex:pick-and-install');
  },
  uninstall(id) {
    return ipcRenderer.invoke('dex:uninstall', id);
  },
  settingsCatalog() {
    return ipcRenderer.invoke('dex:settings-catalog');
  },
  savePluginSettings(id, draft) {
    return ipcRenderer.invoke('dex:settings-save', { id, draft });
  },
  pickDirectory() {
    return ipcRenderer.invoke('dex:pick-directory');
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file);
  },
  openExternal(url) {
    return ipcRenderer.invoke('dex:open-external', url);
  },
  getUpdateStatus() {
    return ipcRenderer.invoke('updater:get-status');
  },
  onUpdateStatus(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  retryUpdateCheck() {
    return ipcRenderer.invoke('updater:retry');
  },
  installUpdate() {
    return ipcRenderer.invoke('updater:install');
  },
});
