/** 宿主预加载暴露的 window.dex，对照 src/preload/host.cjs。 */

type PluginKind = 'ui' | 'headless';
type PluginSource = 'bundled' | 'dev' | 'installed' | 'local';
type LocalFrom = 'page' | 'config';
type LocalMountMode = 'source' | 'preview' | 'preview-failed';

interface PluginSummary {
  id: string;
  manifestId: string;
  instanceId?: string;
  localFrom?: LocalFrom;
  mount?: LocalMountMode;
  previewError?: string;
  displayName: string;
  version: string;
  type: PluginKind;
  uiUrl: string | null;
  source: PluginSource;
  originChannel?: 'market' | 'file';
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

interface DexResult {
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

interface OkResult {
  ok: boolean;
  message?: string;
}

interface PreparePluginResult {
  partition: string;
  preloadUrl: string;
}

interface AvailableMemoryResult {
  ok: boolean;
  bytes?: number;
}

interface SettingsFieldView {
  key: string;
  type: 'string' | 'boolean' | 'number' | 'select' | 'path';
  title: string;
  description?: string;
  secret?: true;
  options?: string[];
  default?: string | number | boolean;
  value?: string | number | boolean;
  secretSet?: boolean;
  group?: string;
}

interface SettingsPluginView {
  id: string;
  displayName: string;
  source: PluginSource;
  settingsEntryUrl: string | null;
  schemaError: string | null;
  fields: SettingsFieldView[];
  iconUrl?: string;
}

interface SettingsSaveResult {
  ok: boolean;
  message?: string;
}

interface RevealSecretResult {
  ok: boolean;
  value?: string;
}

interface PickDirectoryResult {
  cancelled: boolean;
  path?: string;
}

interface GeneralSettings {
  version: string;
  userData: string;
  installedPlugins: string;
}

interface OpenPathResult {
  ok: boolean;
  message?: string;
}

interface CatalogPlugin {
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

interface PluginUpdateNotice {
  id: string;
  version: string;
  remoteVersion: string;
}

interface PluginCatalogResult {
  ok: boolean;
  message?: string;
  generatedAt?: string;
  plugins: CatalogPlugin[];
  updates: PluginUpdateNotice[];
}

interface RuntimeProgress {
  id: string;
  phase: 'preparing';
  bin?: string;
}

type SilentUpdateEvent =
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

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'downloading'
  | 'readyToInstall'
  | 'installing'
  | 'error'
  | 'unsupported';

type PlatformFlow = 'win-auto' | 'mac-dmg';

interface UpdaterStatusPayload {
  status: UpdateStatus;
  platformFlow: PlatformFlow;
  currentVersion: string;
  availableVersion?: string;
  errorMessage?: string;
  lastCheckedAt?: string;
  progressPercent?: number;
}

interface InstallUpdateResult {
  ok: boolean;
  blockedByTask?: boolean;
}

interface DevFlags {
  forceUpdateIcon: boolean;
}

interface DexHost {
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
  pathForFile(file: File): string;
  openExternal(url: string): Promise<OkResult>;
  openPluginFolder(rootPath: string): Promise<OkResult>;
  generalSettings(): Promise<GeneralSettings>;
  copyText(text: string): Promise<OkResult>;
  openHostData(kind: string): Promise<OpenPathResult>;
  getUpdateStatus(): Promise<UpdaterStatusPayload>;
  onUpdateStatus(callback: (payload: UpdaterStatusPayload) => void): () => void;
  retryUpdateCheck(): Promise<void>;
  installUpdate(): Promise<InstallUpdateResult>;
}

interface LucideIcons {
  createIcons(options?: {
    attrs?: Record<string, string | number>;
    nameAttr?: string;
    icons?: Record<string, unknown>;
    root?: ParentNode;
  }): void;
  icons: Record<string, unknown>;
  [name: string]: unknown;
}

/** lottie-web UMD；渲染层用脚本标签挂上。 */
interface LottieAnimationItem {
  destroy(): void;
  goToAndStop(value: number, isFrame?: boolean): void;
}

interface LottiePlayer {
  loadAnimation(params: {
    container: Element;
    renderer?: string;
    loop?: boolean | number;
    autoplay?: boolean;
    animationData?: object;
    path?: string;
  }): LottieAnimationItem;
}

/** 工作台 chrome 会话（仅内存）。surface 运行时是 workspace / settings / plugins。 */
interface ChromeSession {
  pinned: boolean;
  surface: string;
  pluginsFocus: string | null;
  back: { pluginId: string } | null;
  forward: { surface: string; pluginsFocus?: string | null } | null;
}

interface Window {
  dex: DexHost;
  lucide?: LucideIcons;
  lottie?: LottiePlayer;
}

declare var lucide: LucideIcons | undefined;
declare var lottie: LottiePlayer | undefined;

/**
 * getElementById 在本仓常直接当按钮 / 输入 / dialog 用。
 * 不为每个查询写断言，在 checkJs 下放宽这些属性。
 */
interface HTMLElement {
  disabled: boolean;
  value: string;
  open: boolean;
  showModal(): void;
  close(): void;
}

/** Electron &lt;webview&gt; 在渲染层当普通元素用。 */
interface ElectronWebviewElement extends HTMLElement {
  reload(): void;
  getWebContentsId?: () => number;
  src: string;
}

interface HTMLElementTagNameMap {
  webview: ElectronWebviewElement;
}

interface ElectronDidFailLoadEvent extends Event {
  isMainFrame: boolean;
  errorCode: number;
  errorDescription: string;
}

interface UpdaterBridge {
  status(): UpdaterStatusPayload | null;
  onStatus(callback: (payload: UpdaterStatusPayload) => void): () => void;
  openInstallDialog(): void;
}

interface ChromeBridge {
  session(): ChromeSession | null;
  refresh(): void;
  enterPlugins(): void | Promise<void>;
  focusPlugin(pluginId: string): void;
  usePlugin(pluginId: string): Promise<void>;
  clearNavigation(): void;
  openSettings(pluginId?: string): Promise<void>;
}
