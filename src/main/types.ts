export type {
  PluginKind,
  PluginSource,
  LocalFrom,
  LocalMountMode,
  PluginSummary,
  DexResult,
  PluginConfigValue,
  ConfigFieldType,
} from '../shared/dex-bridge.ts';

import type {
  PluginKind,
  PluginSource,
  LocalFrom,
  LocalMountMode,
  PluginConfigValue,
  ConfigFieldType,
} from '../shared/dex-bridge.ts';

export type RuntimeLayout = 'repo' | 'published';

export interface Logger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

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

export interface HostModelsCallOptions {
  idempotencyKey?: string;
}

export interface HostImageGenerateInput {
  model: string;
  input: {
    prompt: string;
    aspect_ratio?: string;
    input_images?: string[];
  };
  outputPath: string;
}

export interface HostImageGenerateResult {
  status: 'succeeded';
  output: string;
  model: string;
}

/** 插件经宿主调用网关。id 由宿主盖上，参数里没有 pluginId。 */
export interface HostModels {
  list: () => Promise<unknown>;
  billing: {
    quote: (body: unknown, options?: HostModelsCallOptions) => Promise<unknown>;
  };
  chat: {
    completions: {
      create: (body: unknown, options?: HostModelsCallOptions) => Promise<unknown>;
    };
  };
  images: {
    generate: (
      input: HostImageGenerateInput,
      options?: HostModelsCallOptions,
    ) => Promise<HostImageGenerateResult>;
  };
}

export interface AppContext {
  registerService: <T = unknown>(name: string, service: T) => void;
  getService: <T = unknown>(name: string) => T | undefined;
  logger: Logger;
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  /** 经宿主调用线上模型。清单 id 由宿主盖上。 */
  models: HostModels;
  /**
   * 无参买断确认：先登录，再买断。不看积分。
   * 作者从 SDK 调用 `requireEntitlement(ctx)`，不要直接碰这个字段。
   * 试玩可传 mock 选项；其它插件忽略传入参数。
   */
  requireEntitlement: (...args: unknown[]) => Promise<void>;
  /** 默认值与已保存值合并后的本插件配置。声明非法时为空对象。 */
  getPluginConfig: () => PluginConfig;
  /**
   * 给子进程的环境变量副本：先复制宿主环境，再盖上本插件配置的字符串形式。
   * 不修改宿主 process.env。没有 runtime、但准备了外部命令时，PATH 前面还有这些命令的目录。
   */
  pluginEnv: () => NodeJS.ProcessEnv;
  /** 用户数据与可重建缓存。已安装插件分别在 plugin-data 与 plugin-runtime。 */
  dirs: PluginDirs;
  /**
   * 清单声明了 externalTools 且准备成功时才有。键是 bin 与 extraBins，值是绝对路径。
   */
  tools?: Record<string, string>;
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

export interface ExternalToolGuideByPlatform {
  darwin?: string;
  win32?: string;
}

/** 插件要在子进程里调用的本机命令。宿主只检查 PATH，不代装。 */
export interface ExternalToolSpec {
  bin: string;
  extraBins?: string[];
  guide?: string | ExternalToolGuideByPlatform;
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
  /** 合法的外部命令。空数组不会留下这个字段。 */
  externalTools?: ExternalToolSpec[];
  /** 写了 externalTools 但不可用。插件仍然出现在列表，不执行 apply。 */
  externalToolsError?: string;
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
  /** 本次准备好的外部命令。有 runtime 时目录进 runtime.env，否则进 pluginEnv。 */
  toolBins?: Record<string, string>;
  toolDirs?: string[];
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
