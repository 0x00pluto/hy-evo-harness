/**
 * 宿主桥与 IPC 可结构化克隆的契约。
 * 主进程实现与渲染层 checkJs 共用这一份，避免手抄两套。
 */

export type PluginKind = 'ui' | 'headless';

export type PluginSource = 'bundled' | 'dev' | 'installed' | 'local';

export type LocalFrom = 'page' | 'config';

export type LocalMountMode = 'source' | 'preview' | 'preview-failed';

export type ConfigFieldType = 'string' | 'boolean' | 'number' | 'select' | 'path';

export type PluginConfigValue = string | number | boolean;

export interface PluginSummary {
  id: string;
  /** 清单 id。已安装和内置插件与 id 相同；本地实例是另一把钥匙。 */
  manifestId: string;
  /** 仅本地实例。形式是 dev- 加 32 位十六进制。 */
  instanceId?: string;
  localFrom?: LocalFrom;
  mount?: LocalMountMode;
  /** 发布预览没准备好。插件未执行 apply。 */
  previewError?: string;
  displayName: string;
  version: string;
  type: PluginKind;
  uiUrl: string | null;
  source: PluginSource;
  /** 仅已安装插件。市场或压缩包。没有记录时界面按压缩包显示。 */
  originChannel?: 'market' | 'file';
  /** 插件目录的绝对路径。本地实例是源码目录。 */
  rootPath: string;
  hasSettings: boolean;
  description?: string;
  iconUrl?: string;
  developer?: string;
  category?: string;
  website?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  catalogError?: string;
  runtimeError?: string;
  installPrompt?: string;
}

export interface DexResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  plugins: PluginSummary[];
  installedId?: string;
  focusedId?: string;
  ignored?: boolean;
  /** 本地目录已在列表里时加载成功但不弹「已加载」。 */
  already?: boolean;
}

export interface OkResult {
  ok: boolean;
  message?: string;
}

export interface PreparePluginResult {
  partition: string;
  preloadUrl: string;
}

export type AvailableMemoryResult = { ok: true; bytes: number } | { ok: false };

export interface SettingsFieldView {
  key: string;
  type: ConfigFieldType;
  title: string;
  description?: string;
  secret?: true;
  options?: string[];
  default?: PluginConfigValue;
  value?: PluginConfigValue;
  secretSet?: boolean;
  group?: string;
}

export interface SettingsPluginView {
  id: string;
  displayName: string;
  source: PluginSource;
  settingsEntryUrl: string | null;
  schemaError: string | null;
  fields: SettingsFieldView[];
  iconUrl?: string;
}

export type SettingsSaveResult = { ok: true } | { ok: false; message: string };

export interface RevealSecretResult {
  ok: boolean;
  value?: string;
}

export interface PickDirectoryResult {
  cancelled: boolean;
  path?: string;
}

export interface GeneralSettings {
  version: string;
  userData: string;
  installedPlugins: string;
}

export interface OpenPathResult {
  ok: boolean;
  message?: string;
}

export interface CatalogPlugin {
  id: string;
  displayName: string;
  version: string;
  description?: string;
  category?: string;
  iconUrl?: string;
  downloadUrl: string;
  sha256: string;
  installPath: string;
}

export interface PluginUpdateNotice {
  id: string;
  version: string;
  remoteVersion: string;
}

export interface PluginCatalogResult {
  ok: boolean;
  message?: string;
  generatedAt?: string;
  plugins: CatalogPlugin[];
  updates: PluginUpdateNotice[];
}

export interface RuntimeProgress {
  id: string;
  phase: 'preparing';
  bin?: string;
}

export type SilentUpdateEvent =
  | { phase: 'start'; id: string }
  | {
      phase: 'result';
      id: string;
      ok: boolean;
      message?: string;
      plugins?: PluginSummary[];
      installedId?: string;
    }
  | { phase: 'idle' };

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'downloading'
  | 'readyToInstall'
  | 'installing'
  | 'error'
  | 'unsupported';

export type PlatformFlow = 'win-auto' | 'mac-dmg';

export interface UpdaterStatusPayload {
  status: UpdateStatus;
  platformFlow: PlatformFlow;
  currentVersion: string;
  availableVersion?: string;
  errorMessage?: string;
  lastCheckedAt?: string;
  progressPercent?: number;
}

export interface InstallUpdateResult {
  ok: boolean;
  blockedByTask?: boolean;
}

export interface DevFlags {
  forceUpdateIcon: boolean;
}

/** 登录进度；不含任何 token。 */
export type GatewayLoginPhase =
  | 'idle'
  | 'opening_browser'
  | 'waiting_callback'
  | 'device_pending'
  | 'exchanging'
  | 'failed';

export interface GatewayLoginProgress {
  phase: GatewayLoginPhase;
  message?: string;
  userCode?: string;
  canPasteCode?: boolean;
  canReopenLogin?: boolean;
  canCancel?: boolean;
}

/** 渲染层可见的买断项；不含 token。 */
export interface GatewayBuyoutView {
  pluginId: string;
  displayName: string;
}

/** 渲染层可见的会话摘要；不含 access / refresh。 */
export interface GatewaySessionView {
  signedIn: boolean;
  phoneMasked: string | null;
  balance: number | null;
  currency: string | null;
  buyouts: GatewayBuyoutView[];
  login: GatewayLoginProgress;
}

/** 烧模型之前被宿主拦住。工作台弹框，插件仍收到原错误。 */
export type SpendBlockedReason = 'NOT_ENTITLED' | 'UNAUTHORIZED' | 'INSUFFICIENT_CREDITS';

export interface SpendBlockedPayload {
  pluginId: string;
  reason: SpendBlockedReason;
}

/** 对照预加载暴露的 window.dex；底层通道见 dex-ipc.ts。 */
export interface DexHost {
  devFlags(): Promise<DevFlags>;
  listPlugins(): Promise<PluginSummary[]>;
  localUsername(): Promise<string>;
  preparePlugin(id: string): Promise<PreparePluginResult>;
  availableMemory(): Promise<AvailableMemoryResult>;
  setViewThrottling(webContentsId: number, throttle: boolean): Promise<void>;
  installZip(zipFilePath: string): Promise<DexResult>;
  pickAndInstall(): Promise<DexResult>;
  uninstall(id: string): Promise<DexResult>;
  loadUnpackedDirectory(): Promise<DexResult>;
  reloadUnpacked(id: string): Promise<DexResult>;
  startPreview(id: string): Promise<DexResult>;
  endPreview(id: string): Promise<DexResult>;
  removeUnpacked(id: string): Promise<DexResult>;
  retryPluginRuntime(id: string): Promise<DexResult>;
  onRuntimeProgress(callback: (payload: RuntimeProgress) => void): () => void;
  pluginCatalog(): Promise<PluginCatalogResult>;
  installCatalogPlugin(id: string): Promise<DexResult>;
  setWatchingPlugin(id: string | null): void;
  onPluginSilentUpdate(callback: (payload: SilentUpdateEvent) => void): () => void;
  settingsCatalog(): Promise<SettingsPluginView[]>;
  savePluginSettings(id: string, draft: unknown): Promise<SettingsSaveResult>;
  revealPluginSecret(id: string, key: string): Promise<RevealSecretResult>;
  pickDirectory(): Promise<PickDirectoryResult>;
  /** 渲染层传入 File；主进程用 webUtils.getPathForFile。 */
  pathForFile(file: object): string;
  openExternal(url: string): Promise<OkResult>;
  openPluginFolder(rootPath: string): Promise<OkResult>;
  generalSettings(): Promise<GeneralSettings>;
  copyText(text: string): Promise<OkResult>;
  openHostData(kind: string): Promise<OpenPathResult>;
  getUpdateStatus(): Promise<UpdaterStatusPayload>;
  onUpdateStatus(callback: (payload: UpdaterStatusPayload) => void): () => void;
  retryUpdateCheck(): Promise<void>;
  installUpdate(): Promise<InstallUpdateResult>;
  gatewaySession(): Promise<GatewaySessionView>;
  startGatewayLogin(): Promise<OkResult>;
  startGatewayDeviceLogin(): Promise<OkResult>;
  cancelGatewayLogin(): Promise<OkResult>;
  submitGatewayAuthCode(code: string): Promise<OkResult>;
  reopenGatewayLogin(): Promise<OkResult>;
  refreshGatewaySession(): Promise<OkResult>;
  openGatewayShop(): Promise<OkResult>;
  logoutGateway(): Promise<OkResult>;
  onGatewaySession(callback: (payload: GatewaySessionView) => void): () => void;
  onSpendBlocked(callback: (payload: SpendBlockedPayload) => void): () => void;
}
