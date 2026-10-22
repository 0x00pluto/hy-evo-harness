import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { DexInvokeMap, DexSendMap } from '../shared/dex-ipc.ts';

type InvokeHandler<C extends keyof DexInvokeMap> = (
  event: IpcMainInvokeEvent,
  ...args: DexInvokeMap[C]['args']
) => DexInvokeMap[C]['result'] | Promise<DexInvokeMap[C]['result']>;

type SendHandler<C extends keyof DexSendMap> = (event: IpcMainEvent, ...args: DexSendMap[C]) => void;

/** 按 DexInvokeMap 约束参数与返回值的 ipcMain.handle。 */
export function handleInvoke<C extends keyof DexInvokeMap>(channel: C, handler: InvokeHandler<C>): void {
  ipcMain.handle(channel, (event, ...args) => {
    return handler(event, ...(args as DexInvokeMap[C]['args']));
  });
}

/** 按 DexSendMap 约束参数的 ipcMain.on。 */
export function onSend<C extends keyof DexSendMap>(channel: C, handler: SendHandler<C>): void {
  ipcMain.on(channel, (event, ...args) => {
    handler(event, ...(args as DexSendMap[C]));
  });
}
