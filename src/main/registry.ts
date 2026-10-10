import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Module } from 'node:module';
import { readManifestFile } from './manifest.ts';
import {
  pluginRuntimeDir,
  preparePluginRuntime,
  runtimeEnv,
  type CommandRunner,
  type RuntimeTools,
} from './plugin-runtime.ts';
import { PluginSettingsStore, isSettingsCandidate, type SettingsPluginView, type SettingsSaveResult } from './plugin-settings.ts';
import { resolvePluginFile } from './protocol.ts';
import type { AppContext, AppPlugin, Logger, PluginManifest, PluginSource, PluginSummary } from './types.ts';

interface CommonJsModule {
  filename: string;
  paths: string[];
  exports: unknown;
  _compile(code: string, filename: string): void;
}

interface CommonJsModuleConstructor {
  new (id: string): CommonJsModule;
  _nodeModulePaths(from: string): string[];
}

const CommonJsModule = Module as unknown as CommonJsModuleConstructor;

type Listener = (...args: unknown[]) => void;

interface Owned {
  services: string[];
  listeners: Array<{ event: string; handler: Listener }>;
}

interface PluginModule {
  apply?: (ctx: AppContext) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}

export class DuplicatePluginError extends Error {
  constructor(id: string) {
    super(`插件 ${id} 已加载，跳过`);
    this.name = 'DuplicatePluginError';
  }
}

const defaultLogger: Logger = {
  info: (msg) => console.log(`[Dex Buddy INFO] ${msg}`),
  error: (msg) => console.error(`[Dex Buddy ERROR] ${msg}`),
};

interface RuntimeProblem {
  manifest: PluginManifest;
  absPath: string;
  source: PluginSource;
  message: string;
}

export interface RuntimeHost {
  userData: string;
  run?: CommandRunner;
  tools?: RuntimeTools;
  onProgress?: (event: { id: string; phase: 'preparing' }) => void;
}

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();
  private readonly plugins = new Map<string, AppPlugin>();
  private readonly problems = new Map<string, RuntimeProblem>();
  private readonly ownership = new Map<string, Owned>();
  private readonly bus = new EventEmitter();
  private settings: PluginSettingsStore;
  private userData: string | null = null;
  private commandRun: CommandRunner | undefined;
  private runtimeTools: RuntimeTools | undefined;
  private onRuntimeProgress: RuntimeHost['onProgress'];
  readonly logger: Logger;

  constructor(logger: Logger = defaultLogger, settings?: PluginSettingsStore) {
    this.logger = logger;
    this.settings = settings ?? new PluginSettingsStore(null, logger);
    this.bus.setMaxListeners(100);
  }

  setSettings(settings: PluginSettingsStore): void {
    this.settings = settings;
  }

  setRuntimeHost(host: RuntimeHost): void {
    this.userData = host.userData;
    this.commandRun = host.run;
    this.runtimeTools = host.tools;
    this.onRuntimeProgress = host.onProgress;
  }

  /** 卸载时丢掉这个插件的依赖和缓存。用户数据目录留给下次安装。 */
  discardRuntime(id: string): void {
    this.problems.delete(id);
    if (!this.userData) return;
    fs.rmSync(pluginRuntimeDir(this.userData, id), { recursive: true, force: true });
  }

  async retryRuntime(id: string): Promise<string | null> {
    const problem = this.problems.get(id);
    if (!problem) return '插件没有待重试的运行环境';
    this.problems.delete(id);
    await this.loadPluginFromDirectory(problem.absPath, problem.source);
    return this.problems.get(id)?.message ?? null;
  }

  registerService<T = unknown>(name: string, service: T): void {
    this.registerOwnedService('__host__', name, service);
  }

  getService<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  emit(event: string, ...args: unknown[]): void {
    this.bus.emit(event, ...args);
  }

  on(event: string, handler: Listener): void {
    this.trackListener('__host__', event, handler);
  }

  getPlugin(id: string): AppPlugin | undefined {
    return this.plugins.get(id);
  }

  listSettingsViews(): SettingsPluginView[] {
    return this.settings.listViews(Array.from(this.plugins.values()));
  }

  settingsView(id: string): SettingsPluginView {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error('插件不存在');
    return this.settings.viewFor(plugin);
  }

  savePluginSettings(id: string, draft: unknown): SettingsSaveResult {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false, message: '插件不存在' };
    return this.settings.save(plugin.manifest, draft);
  }

  revealPluginSecret(id: string, key: string): { ok: true; value: string } | { ok: false } {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false };
    return this.settings.reveal(plugin.manifest, key);
  }

  deletePluginSettings(id: string): void {
    this.settings.deletePlugin(id);
  }

  getPluginList(): PluginSummary[] {
    const loaded = Array.from(this.plugins.values()).map((plugin) => summarizePlugin(plugin));
    const failed = Array.from(this.problems.values())
      .filter((problem) => !this.plugins.has(problem.manifest.id))
      .map((problem) => summarizeProblem(problem));
    return loaded.concat(failed);
  }

  async callService(serviceName: string, method: string, args: unknown[]): Promise<unknown> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(method)) {
      throw new Error(`不允许调用方法: ${method}`);
    }
    const service = this.getService<Record<string, unknown>>(serviceName);
    if (!service || typeof service !== 'object') {
      throw new Error(`服务或方法不存在: ${serviceName}.${method}`);
    }
    const fn = service[method];
    if (!Object.prototype.hasOwnProperty.call(service, method) || typeof fn !== 'function') {
      throw new Error(`服务或方法不存在: ${serviceName}.${method}`);
    }
    return await (fn as (...params: unknown[]) => unknown).apply(service, args);
  }

  /**
   * 扫描一个插件集合目录，或一个本身就是插件根的目录。
   * 单个插件失败只记日志，不打断其余插件。
   */
  async scanAndLoadPlugins(rootDir: string, source: PluginSource): Promise<void> {
    if (!fs.existsSync(rootDir)) return;
    const stat = fs.statSync(rootDir);
    if (!stat.isDirectory()) return;

    const manifestAtRoot = path.join(rootDir, 'plugin.manifest.json');
    if (fs.existsSync(manifestAtRoot)) {
      await this.tryLoadDirectory(rootDir, source);
      return;
    }

    for (const folder of fs.readdirSync(rootDir)) {
      if (folder.startsWith('.') || folder === '__MACOSX') continue;
      const pluginDir = path.join(rootDir, folder);
      let folderStat: fs.Stats;
      try {
        folderStat = fs.statSync(pluginDir);
      } catch {
        continue;
      }
      if (!folderStat.isDirectory()) continue;
      if (!fs.existsSync(path.join(pluginDir, 'plugin.manifest.json'))) continue;
      await this.tryLoadDirectory(pluginDir, source);
    }
  }

  async loadPluginFromDirectory(pluginDir: string, source: PluginSource): Promise<void> {
    const manifest = readManifestFile(pluginDir);
    if (this.plugins.has(manifest.id)) {
      throw new DuplicatePluginError(manifest.id);
    }
    const prepared = await preparePluginRuntime({
      userData: this.userData,
      pluginDir,
      source,
      spec: manifest.runtime,
      run: this.commandRun,
      tools: this.runtimeTools,
      onProgress: manifest.runtime
        ? () => this.onRuntimeProgress?.({ id: manifest.id, phase: 'preparing' })
        : undefined,
    });
    if (!prepared.ok) {
      this.problems.set(manifest.id, {
        manifest,
        absPath: path.resolve(pluginDir),
        source,
        message: prepared.message,
      });
      this.logger.error(`插件 ${manifest.id} 的运行环境未就绪: ${prepared.message}`);
      return;
    }
    const pluginModule = this.loadModule(pluginDir, manifest.main);
    const plugin: AppPlugin = {
      manifest,
      absPath: path.resolve(pluginDir),
      source,
      apply: pluginModule.apply,
      dispose: pluginModule.dispose,
      dirs: prepared.dirs,
      runtimeBins: prepared.bins,
    };
    await this.loadPlugin(plugin);
  }

  async loadPlugin(plugin: AppPlugin): Promise<void> {
    const id = plugin.manifest.id;
    if (this.plugins.has(id)) {
      throw new DuplicatePluginError(id);
    }

    const owned: Owned = { services: [], listeners: [] };
    const ctx = this.createContext(owned, plugin);
    try {
      this.logger.info(`挂载插件: ${plugin.manifest.displayName} (${id})`);
      await plugin.apply(ctx);
    } catch (err) {
      this.releaseOwned(owned);
      throw err;
    }

    this.plugins.set(id, plugin);
    this.ownership.set(id, owned);
  }

  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (!plugin) return;

    try {
      if (plugin.dispose) await plugin.dispose();
    } catch (err) {
      this.logger.error(`卸载插件 ${id} 时 dispose 失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      const owned = this.ownership.get(id);
      if (owned) this.releaseOwned(owned);
      this.ownership.delete(id);
      this.plugins.delete(id);
      this.logger.info(`卸载插件: ${plugin.manifest.displayName}`);
    }
  }

  private async tryLoadDirectory(pluginDir: string, source: PluginSource): Promise<void> {
    try {
      await this.loadPluginFromDirectory(pluginDir, source);
    } catch (err) {
      if (err instanceof DuplicatePluginError) {
        this.logger.info(err.message);
        return;
      }
      this.logger.error(`加载插件 [${pluginDir}] 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private loadModule(pluginDir: string, main: string | undefined): {
    apply: AppPlugin['apply'];
    dispose?: AppPlugin['dispose'];
  } {
    if (!main) {
      return { apply: () => {} };
    }
    const entryPath = resolvePluginFile(pluginDir, main);
    if (!entryPath || !fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
      throw new Error(`入口不存在: ${main ?? ''}`);
    }
    // 宿主 package 是 ESM。插件契约仍是 CommonJS，因此按文件内容编译，不跟 package.json 的 type 走。
    const pluginModule = loadCommonJs(entryPath);
    return {
      apply: typeof pluginModule.apply === 'function' ? pluginModule.apply.bind(pluginModule) : () => {},
      dispose: typeof pluginModule.dispose === 'function' ? pluginModule.dispose.bind(pluginModule) : undefined,
    };
  }

  private createContext(owned: Owned, plugin: AppPlugin): AppContext {
    return {
      logger: this.logger,
      registerService: (name, service) => {
        this.registerOwnedService(owned, name, service);
      },
      getService: (name) => this.getService(name),
      emit: (event, ...args) => {
        this.emit(event, ...args);
      },
      on: (event, handler) => {
        this.trackListener(owned, event, handler);
      },
      getPluginConfig: () => this.settings.getPluginConfig(plugin.manifest),
      pluginEnv: () => this.settings.pluginEnv(plugin.manifest, process.env),
      dirs: plugin.dirs ?? {
        data: plugin.absPath,
        cache: path.join(plugin.absPath, 'cache'),
      },
      ...runtimeBinding(plugin, () => this.settings.pluginEnv(plugin.manifest, process.env)),
    };
  }

  private registerOwnedService(owner: Owned | string, name: string, service: unknown): void {
    if (typeof name !== 'string' || name.trim() === '') {
      this.logger.error('服务名无效，拒绝注册');
      return;
    }
    if (this.services.has(name)) {
      this.logger.error(`Service '${name}' 已存在，拒绝重复注册`);
      return;
    }
    this.services.set(name, service);
    const owned = typeof owner === 'string' ? this.ownedBucket(owner) : owner;
    owned.services.push(name);
  }

  private trackListener(owner: Owned | string, event: string, handler: Listener): void {
    // Node 的 EventEmitter 监听器签名使用 any[]，断言只为通过类型检查，运行时仍是同一个函数。
    this.bus.on(event, handler as (...args: any[]) => void);
    const owned = typeof owner === 'string' ? this.ownedBucket(owner) : owner;
    owned.listeners.push({ event, handler });
  }

  private ownedBucket(ownerId: string): Owned {
    const existing = this.ownership.get(ownerId);
    if (existing) return existing;
    const created: Owned = { services: [], listeners: [] };
    this.ownership.set(ownerId, created);
    return created;
  }

  private releaseOwned(owned: Owned): void {
    for (const name of owned.services) {
      this.services.delete(name);
    }
    owned.services.length = 0;
    for (const { event, handler } of owned.listeners) {
      this.bus.off(event, handler as (...args: any[]) => void);
    }
    owned.listeners.length = 0;
  }

}

function runtimeBinding(
  plugin: AppPlugin,
  pluginEnv: () => NodeJS.ProcessEnv,
): { runtime: AppContext['runtime'] } | Record<string, never> {
  if (!plugin.runtimeBins) return {};
  const bins = plugin.runtimeBins;
  return {
    runtime: {
      ...bins,
      get env() {
        return runtimeEnv(pluginEnv(), bins);
      },
    },
  };
}

function summarizeProblem(problem: RuntimeProblem): PluginSummary {
  return {
    ...summarizePlugin({
      manifest: problem.manifest,
      absPath: problem.absPath,
      source: problem.source,
      apply: () => {},
    }),
    runtimeError: problem.message,
  };
}

function summarizePlugin(plugin: AppPlugin): PluginSummary {
  const manifest = plugin.manifest;
  const summary: PluginSummary = {
    id: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    type: manifest.type,
    uiUrl:
      manifest.type === 'ui' && manifest.uiEntry
        ? `app-plugin://${manifest.id}/${manifest.uiEntry}`
        : null,
    source: plugin.source,
    rootPath: plugin.absPath,
    hasSettings: isSettingsCandidate(manifest),
  };
  if (manifest.description) summary.description = manifest.description;
  if (manifest.icon) {
    const iconPath = manifest.icon.split(/[/\\]/).map((part) => encodeURIComponent(part)).join('/');
    summary.iconUrl = `app-plugin://${manifest.id}/${iconPath}`;
  }
  if (manifest.developer) summary.developer = manifest.developer;
  if (manifest.category) summary.category = manifest.category;
  if (manifest.website) summary.website = manifest.website;
  if (manifest.privacyPolicy) summary.privacyPolicy = manifest.privacyPolicy;
  if (manifest.termsOfService) summary.termsOfService = manifest.termsOfService;
  if (manifest.catalogError) summary.catalogError = manifest.catalogError;
  return summary;
}

function loadCommonJs(entryPath: string): PluginModule {
  const filename = path.resolve(entryPath);
  const source = fs.readFileSync(filename, 'utf8');
  const mod = new CommonJsModule(filename);
  mod.filename = filename;
  mod.paths = CommonJsModule._nodeModulePaths(path.dirname(filename));
  mod._compile(source, filename);
  return mod.exports as PluginModule;
}
