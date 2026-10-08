const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  listPlugins() {
    return ipcRenderer.invoke('hub:list-plugins');
  },
  preparePlugin(id) {
    return ipcRenderer.invoke('hub:prepare-plugin', id);
  },
  installZip(zipFilePath) {
    return ipcRenderer.invoke('hub:install-zip', zipFilePath);
  },
  pickAndInstall() {
    return ipcRenderer.invoke('hub:pick-and-install');
  },
  uninstall(id) {
    return ipcRenderer.invoke('hub:uninstall', id);
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
