import { contextBridge, ipcRenderer } from 'electron';
import type { DexInvokeMap } from '../shared/dex-ipc.ts';

function invoke<C extends keyof DexInvokeMap>(
  channel: C,
  ...args: DexInvokeMap[C]['args']
): Promise<DexInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<DexInvokeMap[C]['result']>;
}

/** IPC 只能传可结构化克隆的值；Alpine / Vue 代理先打成纯 JSON。 */
function plainArgs(args: unknown): unknown[] {
  const list = Array.isArray(args) ? args : [];
  return JSON.parse(JSON.stringify(list)) as unknown[];
}

contextBridge.exposeInMainWorld('dex', {
  call(serviceName: string, method: string, args: unknown) {
    return invoke('dex:call-service', {
      serviceName,
      method,
      args: plainArgs(args),
    });
  },
  readSettings() {
    return invoke('dex:plugin-settings-get');
  },
  saveSettings(draft: unknown) {
    return invoke('dex:plugin-settings-save', draft);
  },
});
