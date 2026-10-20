const { contextBridge, ipcRenderer } = require('electron');

/** IPC 只能传可结构化克隆的值；Alpine / Vue 代理先打成纯 JSON。 */
function plainArgs(args) {
  const list = Array.isArray(args) ? args : [];
  return JSON.parse(JSON.stringify(list));
}

contextBridge.exposeInMainWorld('dex', {
  call(serviceName, method, args) {
    return ipcRenderer.invoke('dex:call-service', {
      serviceName,
      method,
      args: plainArgs(args),
    });
  },
  readSettings() {
    return ipcRenderer.invoke('dex:plugin-settings-get');
  },
  saveSettings(draft) {
    return ipcRenderer.invoke('dex:plugin-settings-save', draft);
  },
});
