const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dex', {
  call(serviceName, method, args) {
    return ipcRenderer.invoke('dex:call-service', {
      serviceName,
      method,
      args: Array.isArray(args) ? args : [],
    });
  },
});
