/**
 * 渲染层全局与 Electron 辅助类型。
 * window.dex / IPC 形状见 src/shared/dex-bridge.ts。
 */

import type {
  DexHost,
  PluginSummary,
  UpdaterStatusPayload,
  UpdateStatus,
  SettingsSaveResult,
  SettingsPluginView,
  SettingsFieldView,
  CatalogPlugin,
  PluginUpdateNotice,
  DexResult,
  PreparePluginResult,
  PluginSource,
  GatewaySessionView,
  GatewayLoginProgress,
  GatewayLoginPhase,
} from '../shared/dex-bridge.ts';

export type {
  PluginSummary,
  UpdaterStatusPayload,
  UpdateStatus,
  DexHost,
  SettingsSaveResult,
  SettingsPluginView,
  SettingsFieldView,
  CatalogPlugin,
  PluginUpdateNotice,
  DexResult,
  PreparePluginResult,
  PluginSource,
  GatewaySessionView,
  GatewayLoginProgress,
  GatewayLoginPhase,
};

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

declare global {
  /** checkJs JSDoc 用：从 shared 契约提成全局名。 */
  type PluginSummary = import('../shared/dex-bridge.ts').PluginSummary;
  type UpdateStatus = import('../shared/dex-bridge.ts').UpdateStatus;
  type UpdaterStatusPayload = import('../shared/dex-bridge.ts').UpdaterStatusPayload;
  type SettingsSaveResult = import('../shared/dex-bridge.ts').SettingsSaveResult;
  type SettingsPluginView = import('../shared/dex-bridge.ts').SettingsPluginView;
  type SettingsFieldView = import('../shared/dex-bridge.ts').SettingsFieldView;
  type CatalogPlugin = import('../shared/dex-bridge.ts').CatalogPlugin;
  type PluginUpdateNotice = import('../shared/dex-bridge.ts').PluginUpdateNotice;
  type DexResult = import('../shared/dex-bridge.ts').DexResult;
  type PreparePluginResult = import('../shared/dex-bridge.ts').PreparePluginResult;
  type PluginSource = import('../shared/dex-bridge.ts').PluginSource;
  type GatewaySessionView = import('../shared/dex-bridge.ts').GatewaySessionView;
  type GatewayLoginProgress = import('../shared/dex-bridge.ts').GatewayLoginProgress;
  type GatewayLoginPhase = import('../shared/dex-bridge.ts').GatewayLoginPhase;

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

  var lucide: LucideIcons | undefined;
  var lottie: LottiePlayer | undefined;

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
}

export {};
