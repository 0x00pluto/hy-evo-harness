export type PluginKind = 'ui' | 'headless';

export type PluginSource = 'bundled' | 'dev' | 'installed';

export interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

export interface AppContext {
  registerService: <T = unknown>(name: string, service: T) => void;
  getService: <T = unknown>(name: string) => T | undefined;
  logger: Logger;
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface PluginManifest {
  id: string;
  displayName: string;
  version: string;
  type: PluginKind;
  main?: string;
  uiEntry?: string;
}

export interface AppPlugin {
  manifest: PluginManifest;
  absPath: string;
  source: PluginSource;
  apply: (ctx: AppContext) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}

export interface PluginSummary {
  id: string;
  displayName: string;
  version: string;
  type: PluginKind;
  uiUrl: string | null;
  source: PluginSource;
}

export interface HubResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  plugins: PluginSummary[];
}
