const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  call(serviceName, method, args) {
    return ipcRenderer.invoke('hub:call-service', {
      serviceName,
      method,
      args: Array.isArray(args) ? args : [],
    });
  },
});
