export type PluginKind = 'ui' | 'headless';

export type PluginSource = 'bundled' | 'dev' | 'installed';

export interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

export type ConfigFieldType = 'string' | 'boolean' | 'number' | 'select' | 'path';

export type PluginConfigValue = string | number | boolean;

export type PluginConfig = Record<string, PluginConfigValue>;

export interface ConfigField {
  type: ConfigFieldType;
  title: string;
  description?: string;
  /** 仅字符串字段。目录和插件页面不回显明文；设置页的眼睛可以临时查看。 */
  secret?: true;
  /** 设置页分组。不写时归入「通用配置」，不进入配置值。 */
  group?: string;
  options?: string[];
  default?: PluginConfigValue;
}

export type ConfigSchema = Record<string, ConfigField>;

export interface AppContext {
  registerService: <T = unknown>(name: string, service: T) => void;
  getService: <T = unknown>(name: string) => T | undefined;
  logger: Logger;
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  /** 默认值与已保存值合并后的本插件配置。声明非法时为空对象。 */
  getPluginConfig: () => PluginConfig;
  /**
   * 给子进程的环境变量副本：先复制宿主环境，再盖上本插件配置的字符串形式。
   * 不修改宿主 process.env。
   */
  pluginEnv: () => NodeJS.ProcessEnv;
}

export interface PluginManifest {
  id: string;
  displayName: string;
  version: string;
  type: PluginKind;
  main?: string;
  uiEntry?: string;
  settingsEntry?: string;
  /** 仅在声明合法时存在。空对象表示声明了，但没有字段。 */
  configSchema?: ConfigSchema;
  /** 写出了 configSchema 但整份声明不可用。插件仍然加载。 */
  configSchemaError?: string;
  description?: string;
  /** 插件目录内的相对路径。文件不存在时不会留下这个字段。 */
  icon?: string;
  developer?: string;
  category?: string;
  website?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  /** 目录字段写了但不合法。插件仍然加载，非法字段不展示。 */
  catalogError?: string;
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
  /** 插件目录的绝对路径，用于首页悬停卡片和详情里的目录提示。 */
  rootPath: string;
  /** 有 configSchema 或 settingsEntry 时，首页悬停卡片可以进入它的设置。 */
  hasSettings: boolean;
  description?: string;
  iconUrl?: string;
  developer?: string;
  category?: string;
  website?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  catalogError?: string;
}

export interface DexResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  plugins: PluginSummary[];
  /** 本次安装成功的插件 id。覆盖安装同一个 id 时界面靠它打开详情。 */
  installedId?: string;
}
