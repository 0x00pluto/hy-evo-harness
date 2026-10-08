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
});
