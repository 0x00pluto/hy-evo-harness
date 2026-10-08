const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dex', {
  call(serviceName, method, args) {
    return ipcRenderer.invoke('dex:call-service', {
      serviceName,
      method,
      args: Array.isArray(args) ? args : [],
    });
  },
  readSettings() {
    return ipcRenderer.invoke('dex:plugin-settings-get');
  },
  saveSettings(draft) {
    return ipcRenderer.invoke('dex:plugin-settings-save', draft);
  },
});
