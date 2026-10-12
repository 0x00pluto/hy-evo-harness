export type PluginKind = 'ui' | 'headless';

export type PluginSource = 'bundled' | 'dev' | 'installed' | 'local';

export type LocalFrom = 'page' | 'config';

export type LocalMountMode = 'source' | 'preview' | 'preview-failed';

export type RuntimeLayout = 'repo' | 'published';

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
  /** 用户数据与可重建缓存。已安装插件分别在 plugin-data 与 plugin-runtime。 */
  dirs: PluginDirs;
  /**
   * 仅当清单声明了 runtime。python / node 只包含已声明的那一项。
   * env 每次读取都会重新合并插件配置。
   */
  runtime?: PluginRuntimeBindings;
}

export interface PluginDirs {
  data: string;
  cache: string;
}

export interface PluginRuntimeSpec {
  python?: { requirements: string };
  node?: { package: string };
}

export interface PluginRuntimeBindings {
  python?: string;
  node?: string;
  readonly env: NodeJS.ProcessEnv;
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
  /** 清单声明了运行时。没有版本号，解释器版本由宿主钉死。 */
  runtime?: PluginRuntimeSpec;
}

export interface AppPlugin {
  manifest: PluginManifest;
  absPath: string;
  source: PluginSource;
  /**
   * 注册表、设置、协议主机名和数据目录。
   * 缺省等于清单 id。本地目录传入实例 id。
   */
  registryId?: string;
  /** 作者仓库。预览时 absPath 指向副本，这里仍是源码目录。 */
  sourcePath?: string;
  localFrom?: LocalFrom;
  mount?: LocalMountMode;
  apply: (ctx: AppContext) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
  dirs?: PluginDirs;
  /** 已准备好的解释器。env 由上下文在读取时生成。 */
  runtimeBins?: { python?: string; node?: string };
}

export interface LocalRecord {
  instanceId: string;
  manifestId: string;
  sourcePath: string;
  registeredPath: string;
  from: LocalFrom;
  mount: LocalMountMode;
  previewError?: string;
}

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
  /** 插件目录的绝对路径，用于首页悬停卡片和详情里的目录提示。本地实例是源码目录。 */
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
  /** 运行环境没准备好。插件未执行 apply。 */
  runtimeError?: string;
}

export interface DexResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  plugins: PluginSummary[];
  /** 本次安装成功的插件 id。覆盖安装同一个 id 时界面靠它打开详情。 */
  installedId?: string;
  /** 本地目录加载后要定位的实例 id。 */
  focusedId?: string;
}
