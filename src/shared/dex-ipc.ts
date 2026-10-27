/**
 * IPC 通道 → 参数 / 返回值。
 * 主进程 handleInvoke、预加载 invoke、渲染层 DexHost 共用这一份。
 */

import type {
  AvailableMemoryResult,
  DevFlags,
  DexResult,
  GatewaySessionView,
  GeneralSettings,
  InstallUpdateResult,
  OkResult,
  OpenPathResult,
  PickDirectoryResult,
  PluginCatalogResult,
  PreparePluginResult,
  PluginSummary,
  RevealSecretResult,
  RuntimeProgress,
  SettingsPluginView,
  SettingsSaveResult,
  SilentUpdateEvent,
  SpendBlockedPayload,
  UpdaterStatusPayload,
} from './dex-bridge.ts';

export interface CallServicePayload {
  serviceName: string;
  method: string;
  args: unknown[];
}

export interface SettingsSavePayload {
  id: string;
  draft: unknown;
}

export interface RevealSecretPayload {
  id: string;
  key: string;
}

/** 渲染层 / 插件页 invoke 的通道。 */
export type DexInvokeMap = {
  'dex:dev-flags': { args: []; result: DevFlags };
  'dex:list-plugins': { args: []; result: PluginSummary[] };
  'dex:local-username': { args: []; result: string };
  'dex:prepare-plugin': { args: [id: string]; result: PreparePluginResult };
  'dex:available-memory': { args: []; result: AvailableMemoryResult };
  'dex:set-view-throttling': { args: [webContentsId: number, throttle: boolean]; result: void };
  'dex:call-service': { args: [payload: CallServicePayload]; result: unknown };
  'dex:install-zip': { args: [zipFilePath: string]; result: DexResult };
  'dex:pick-and-install': { args: []; result: DexResult };
  'dex:settings-catalog': { args: []; result: SettingsPluginView[] };
  'dex:settings-save': { args: [payload: SettingsSavePayload]; result: SettingsSaveResult };
  'dex:reveal-plugin-secret': { args: [payload: RevealSecretPayload]; result: RevealSecretResult };
  'dex:pick-directory': { args: []; result: PickDirectoryResult };
  'dex:plugin-settings-get': { args: []; result: SettingsPluginView };
  'dex:plugin-settings-save': { args: [draft: unknown]; result: SettingsSaveResult };
  'dex:open-external': { args: [url: string]; result: OkResult };
  'dex:copy-text': { args: [text: string]; result: OkResult };
  'dex:general-settings': { args: []; result: GeneralSettings };
  'dex:open-host-data': { args: [kind: string]; result: OpenPathResult };
  'dex:open-plugin-folder': { args: [rootPath: string]; result: OkResult };
  'dex:plugin-catalog': { args: []; result: PluginCatalogResult };
  'dex:plugin-install-catalog': { args: [id: string]; result: DexResult };
  'dex:retry-plugin-runtime': { args: [id: string]; result: DexResult };
  'dex:uninstall': { args: [id: string]; result: DexResult };
  'dex:load-unpacked-directory': { args: []; result: DexResult };
  'dex:reload-unpacked': { args: [id: string]; result: DexResult };
  'dex:reload-bundled': { args: [id: string]; result: DexResult };
  'dex:start-preview': { args: [id: string]; result: DexResult };
  'dex:end-preview': { args: [id: string]; result: DexResult };
  'dex:remove-unpacked': { args: [id: string]; result: DexResult };
  'updater:get-status': { args: []; result: UpdaterStatusPayload };
  'updater:retry': { args: []; result: void };
  'updater:install': { args: []; result: InstallUpdateResult };
  'dex:gateway-session': { args: []; result: GatewaySessionView };
  'dex:gateway-login-pkce': { args: []; result: OkResult };
  'dex:gateway-login-device': { args: []; result: OkResult };
  'dex:gateway-login-cancel': { args: []; result: OkResult };
  'dex:gateway-submit-code': { args: [code: string]; result: OkResult };
  'dex:gateway-reopen-login': { args: []; result: OkResult };
  'dex:gateway-refresh': { args: []; result: OkResult };
  'dex:gateway-open-shop': { args: []; result: OkResult };
  'dex:gateway-logout': { args: []; result: OkResult };
};

/** 渲染层 → 主进程 send（无返回值）。 */
export type DexSendMap = {
  'dex:set-watching-plugin': [id: string | null];
};

/** 主进程 → 渲染层推送。 */
export type DexPushMap = {
  'dex:runtime-progress': RuntimeProgress;
  'dex:plugin-silent-update': SilentUpdateEvent;
  'dex:plugin-list': PluginSummary[];
  'updater:status': UpdaterStatusPayload;
  'dex:session': GatewaySessionView;
  'dex:spend-blocked': SpendBlockedPayload;
};

export type DexInvokeChannel = keyof DexInvokeMap;
export type DexSendChannel = keyof DexSendMap;
export type DexPushChannel = keyof DexPushMap;
