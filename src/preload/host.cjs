const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dex', {
  listPlugins() {
    return ipcRenderer.invoke('dex:list-plugins');
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
  pathForFile(file) {
    return webUtils.getPathForFile(file);
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
