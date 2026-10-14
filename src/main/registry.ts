import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Module } from 'node:module';
import { readManifestFile } from './manifest.ts';
import { prepareExternalTools, prependToolDirs } from './external-tools.ts';
import {
  pluginRuntimeDir,
  preparePluginRuntime,
  runtimeEnv,
  type CommandRunner,
  type RuntimeTools,
} from './plugin-runtime.ts';
import { PluginSettingsStore, isSettingsCandidate, type SettingsPluginView, type SettingsSaveResult } from './plugin-settings.ts';
import { resolvePluginFile } from './protocol.ts';
import type { AppContext, AppPlugin, LocalMountMode, LocalRecord, Logger, PluginManifest, PluginSource, PluginSummary, RuntimeLayout } from './types.ts';

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
  /** 本地实例的服务不进全局表。 */
  instanceId?: string;
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
  registryId: string;
  manifest: PluginManifest;
  absPath: string;
  sourcePath?: string;
  source: PluginSource;
  message: string;
  /** 外部命令缺失时的可复制说明。解析错误没有这一项。 */
  installPrompt?: string;
  localFrom?: LocalRecord['from'];
  mount?: LocalMountMode;
  /** 发布预览失败。列表用 previewError，而不是运行环境错误。 */
  preview?: boolean;
}

export interface RuntimeProgress {
  id: string;
  phase: 'preparing';
  /** 正在准备的外部命令。解释器阶段没有这一项。 */
  bin?: string;
}

export interface RuntimeHost {
  userData: string;
  run?: CommandRunner;
  tools?: RuntimeTools;
  onProgress?: (event: RuntimeProgress) => void;
  lookup?: (name: string, pathEnv: string, platform: NodeJS.Platform) => string | null;
}

export class ServiceRegistry {
  private readonly services = new Map<string, unknown>();
  private readonly instanceServices = new Map<string, Map<string, unknown>>();
  private readonly hostServiceNames = new Set<string>();
  private readonly plugins = new Map<string, AppPlugin>();
  private readonly problems = new Map<string, RuntimeProblem>();
  private readonly locals = new Map<string, LocalRecord>();
  private readonly ownership = new Map<string, Owned>();
  private readonly bus = new EventEmitter();
  private settings: PluginSettingsStore;
  private userData: string | null = null;
  private commandRun: CommandRunner | undefined;
  private runtimeTools: RuntimeTools | undefined;
  private onRuntimeProgress: RuntimeHost['onProgress'];
  private lookupTool: RuntimeHost['lookup'];
  private originChannel: (id: string) => 'market' | 'file' | undefined = () => undefined;
  readonly logger: Logger;

  constructor(logger: Logger = defaultLogger, settings?: PluginSettingsStore) {
    this.logger = logger;
    this.settings = settings ?? new PluginSettingsStore(null, logger);
    this.bus.setMaxListeners(100);
  }

  setSettings(settings: PluginSettingsStore): void {
    this.settings = settings;
  }

  /** 已安装插件的市场或压缩包记录。列表返回时按清单 id 查。 */
  setOriginLookup(lookup: (id: string) => 'market' | 'file' | undefined): void {
    this.originChannel = lookup;
  }

  setRuntimeHost(host: RuntimeHost): void {
    this.userData = host.userData;
    this.commandRun = host.run;
    this.runtimeTools = host.tools;
    this.onRuntimeProgress = host.onProgress;
    this.lookupTool = host.lookup;
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
    if (problem.source === 'local') {
      const record = this.locals.get(id);
      if (!record || record.mount !== 'source') return '插件没有待重试的运行环境';
      this.problems.delete(id);
      return this.mountLocal({
        record,
        pluginDir: record.sourcePath,
        layout: 'repo',
      });
    }
    this.problems.delete(id);
    await this.loadPluginFromDirectory(problem.absPath, problem.source);
    return this.problems.get(id)?.message ?? null;
  }

  listLocals(): LocalRecord[] {
    return Array.from(this.locals.values());
  }

  getLocal(id: string): LocalRecord | undefined {
    return this.locals.get(id);
  }

  manifestIds(): Set<string> {
    const ids = new Set<string>();
    for (const plugin of this.plugins.values()) ids.add(plugin.manifest.id);
    for (const problem of this.problems.values()) ids.add(problem.manifest.id);
    return ids;
  }

  hasRegistryId(id: string): boolean {
    return this.plugins.has(id) || this.problems.has(id);
  }

  clearLocal(id: string): void {
    this.locals.delete(id);
    this.problems.delete(id);
    this.instanceServices.delete(id);
  }

  noteRegisteredPath(instanceId: string, registeredPath: string): void {
    const local = this.locals.get(instanceId);
    if (!local) return;
    local.registeredPath = registeredPath;
  }

  /** 预览文件集没准备好。不执行 apply，列表仍留着这一条。 */
  failPreview(record: LocalRecord, message: string): void {
    this.problems.delete(record.instanceId);
    this.failLocal({ ...record, mount: 'preview' }, message, record.sourcePath);
  }

  /**
   * 按实例 id 挂上本地目录。失败时不执行 apply，返回原因。
   * 成功返回 null。
   */
  async mountLocal(input: {
    record: LocalRecord;
    pluginDir: string;
    layout: RuntimeLayout;
  }): Promise<string | null> {
    const id = input.record.instanceId;
    if (this.plugins.has(id)) {
      return `插件 ${id} 已加载`;
    }
    for (const plugin of this.plugins.values()) {
      if (plugin.manifest.id === id) {
        const message = `实例 id 与已加载插件 ${plugin.manifest.id} 相同，已拒绝`;
        this.failLocal(input.record, message, input.pluginDir);
        return message;
      }
    }
    this.locals.set(id, { ...input.record, previewError: undefined });
    this.problems.delete(id);

    let manifest: PluginManifest;
    try {
      manifest = readManifestFile(input.pluginDir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.failLocal(input.record, message, input.pluginDir);
      return message;
    }

    const prepared = await preparePluginRuntime({
      userData: this.userData,
      pluginDir: input.pluginDir,
      source: 'local',
      spec: manifest.runtime,
      storageId: id,
      layout: input.layout,
      run: this.commandRun,
      tools: this.runtimeTools,
      onProgress: manifest.runtime
        ? () => this.onRuntimeProgress?.({ id, phase: 'preparing' })
        : undefined,
    });
    if (!prepared.ok) {
      this.failLocal(input.record, prepared.message, input.pluginDir, manifest);
      return prepared.message;
    }
    const tools = await this.prepareDeclaredTools(id, manifest);
    if (!tools.ok) {
      this.failLocal(input.record, tools.message, input.pluginDir, manifest, tools.installPrompt);
      return tools.message;
    }

    let pluginModule: { apply: AppPlugin['apply']; dispose?: AppPlugin['dispose'] };
    try {
      pluginModule = this.loadModule(input.pluginDir, manifest.main);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.failLocal(input.record, message, input.pluginDir, manifest);
      return message;
    }

    const mount = input.record.mount === 'preview' ? 'preview' : 'source';
    const plugin: AppPlugin = {
      manifest,
      absPath: path.resolve(input.pluginDir),
      sourcePath: input.record.sourcePath,
      source: 'local',
      registryId: id,
      localFrom: input.record.from,
      mount,
      apply: pluginModule.apply,
      dispose: pluginModule.dispose,
      dirs: prepared.dirs,
      runtimeBins: prepared.bins,
      toolBins: tools.bins,
      toolDirs: tools.dirs,
    };
    try {
      await this.loadPlugin(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.failLocal(input.record, message, input.pluginDir, manifest);
      return message;
    }
    this.locals.set(id, {
      ...input.record,
      manifestId: manifest.id,
      mount,
      previewError: undefined,
    });
    return null;
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
    return this.settings.save(plugin.manifest, draft, registryIdOf(plugin));
  }

  revealPluginSecret(id: string, key: string): { ok: true; value: string } | { ok: false } {
    const plugin = this.plugins.get(id);
    if (!plugin) return { ok: false };
    return this.settings.reveal(plugin.manifest, key, registryIdOf(plugin));
  }

  deletePluginSettings(id: string): void {
    this.settings.deletePlugin(id);
  }

  getPluginList(): PluginSummary[] {
    const loaded = Array.from(this.plugins.values()).map((plugin) => summarizePlugin(plugin));
    const failed = Array.from(this.problems.values())
      .filter((problem) => !this.plugins.has(problem.registryId))
      .map((problem) => summarizeProblem(problem));
    return loaded.concat(failed).map((plugin) => this.withOrigin(plugin));
  }

  private withOrigin(plugin: PluginSummary): PluginSummary {
    if (plugin.source !== 'installed') return plugin;
    const channel = this.originChannel(plugin.manifestId);
    if (channel !== 'market' && channel !== 'file') return plugin;
    return { ...plugin, originChannel: channel };
  }

  async callService(serviceName: string, method: string, args: unknown[], callerId?: string): Promise<unknown> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(method)) {
      throw new Error(`不允许调用方法: ${method}`);
    }
    const caller = callerId ? this.plugins.get(callerId) : undefined;
    const instanceId = caller?.source === 'local' ? registryIdOf(caller) : undefined;
    const service = this.lookupService(serviceName, instanceId);
    if (!service || typeof service !== 'object') {
      throw new Error(`服务或方法不存在: ${serviceName}.${method}`);
    }
    const record = service as Record<string, unknown>;
    const fn = record[method];
    if (!Object.prototype.hasOwnProperty.call(record, method) || typeof fn !== 'function') {
      throw new Error(`服务或方法不存在: ${serviceName}.${method}`);
    }
    return await (fn as (...params: unknown[]) => unknown).apply(record, args);
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
      this.noteRuntimeProblem(manifest.id, manifest, pluginDir, source, prepared.message);
      return;
    }
    const tools = await this.prepareDeclaredTools(manifest.id, manifest);
    if (!tools.ok) {
      this.noteRuntimeProblem(manifest.id, manifest, pluginDir, source, tools.message, tools.installPrompt);
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
      toolBins: tools.bins,
      toolDirs: tools.dirs,
    };
    await this.loadPlugin(plugin);
  }

  async loadPlugin(plugin: AppPlugin): Promise<void> {
    const id = registryIdOf(plugin);
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
    const id = registryIdOf(plugin);
    const local = plugin.source === 'local';
    return {
      logger: this.logger,
      registerService: (name, service) => {
        this.registerOwnedService(owned, name, service, local ? id : null);
      },
      getService: <T = unknown>(name: string) => this.lookupService(name, local ? id : undefined) as T | undefined,
      emit: (event, ...args) => {
        this.emit(event, ...args);
      },
      on: (event, handler) => {
        this.trackListener(owned, event, handler);
      },
      getPluginConfig: () => this.settings.getPluginConfig(plugin.manifest, id),
      pluginEnv: () => {
        const configEnv = this.settings.pluginEnv(plugin.manifest, process.env, id);
        // 声明了 runtime 时，命令目录写在 runtime.env，避免作者拿错环境。
        if (plugin.runtimeBins) return configEnv;
        return prependToolDirs(configEnv, plugin.toolDirs ?? []);
      },
      dirs: plugin.dirs ?? {
        data: plugin.absPath,
        cache: path.join(plugin.absPath, 'cache'),
      },
      ...runtimeBinding(plugin, () => this.settings.pluginEnv(plugin.manifest, process.env, id)),
      ...(plugin.toolBins ? { tools: { ...plugin.toolBins } } : {}),
    };
  }

  private lookupService(name: string, instanceId?: string): unknown {
    if (instanceId) {
      const own = this.instanceServices.get(instanceId)?.get(name);
      if (own !== undefined) return own;
      if (this.hostServiceNames.has(name)) return this.services.get(name);
      return undefined;
    }
    return this.services.get(name);
  }

  private instanceTable(instanceId: string): Map<string, unknown> {
    const existing = this.instanceServices.get(instanceId);
    if (existing) return existing;
    const created = new Map<string, unknown>();
    this.instanceServices.set(instanceId, created);
    return created;
  }

  private registerOwnedService(owner: Owned | string, name: string, service: unknown, instanceId: string | null = null): void {
    if (typeof name !== 'string' || name.trim() === '') {
      this.logger.error('服务名无效，拒绝注册');
      return;
    }
    const owned = typeof owner === 'string' ? this.ownedBucket(owner) : owner;
    if (instanceId) {
      if (this.hostServiceNames.has(name) || this.instanceTable(instanceId).has(name)) {
        this.logger.error(`Service '${name}' 已存在，拒绝重复注册`);
        return;
      }
      this.instanceTable(instanceId).set(name, service);
      owned.instanceId = instanceId;
      owned.services.push(name);
      return;
    }
    if (this.services.has(name)) {
      this.logger.error(`Service '${name}' 已存在，拒绝重复注册`);
      return;
    }
    this.services.set(name, service);
    if (typeof owner === 'string' && owner === '__host__') this.hostServiceNames.add(name);
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

  private async prepareDeclaredTools(
    id: string,
    manifest: PluginManifest,
  ): Promise<{ ok: true; bins?: Record<string, string>; dirs?: string[] } | { ok: false; message: string; installPrompt?: string }> {
    if (manifest.externalToolsError) return { ok: false, message: manifest.externalToolsError };
    if (!manifest.externalTools || manifest.externalTools.length === 0) return { ok: true };
    const prepared = await prepareExternalTools({
      tools: manifest.externalTools,
      platform: process.platform,
      pathEnv: process.env.PATH ?? process.env.Path ?? '',
      lookup: this.lookupTool,
      onProgress: (bin) => this.onRuntimeProgress?.({ id, phase: 'preparing', bin }),
    });
    if (!prepared.ok) return prepared;
    return { ok: true, bins: prepared.bins, dirs: prepared.dirs };
  }

  private noteRuntimeProblem(
    registryId: string,
    manifest: PluginManifest,
    pluginDir: string,
    source: PluginSource,
    message: string,
    installPrompt?: string,
  ): void {
    this.problems.set(registryId, {
      registryId,
      manifest,
      absPath: path.resolve(pluginDir),
      source,
      message,
      installPrompt,
    });
    this.logger.error(`插件 ${manifest.id} 的运行环境未就绪: ${message}`);
  }

  private failLocal(
    record: LocalRecord,
    message: string,
    pluginDir: string,
    manifest?: PluginManifest,
    installPrompt?: string,
  ): void {
    const failedMount: LocalMountMode = record.mount === 'source' ? 'source' : 'preview-failed';
    const next: LocalRecord = {
      ...record,
      mount: failedMount,
      previewError: failedMount === 'preview-failed' ? message : undefined,
    };
    this.locals.set(record.instanceId, next);
    let parsed = manifest;
    if (!parsed) {
      try {
        parsed = readManifestFile(record.sourcePath);
      } catch {
        parsed = undefined;
      }
    }
    if (!parsed) {
      this.logger.error(`本地插件 ${record.instanceId} 未能挂载: ${message}`);
      return;
    }
    this.problems.set(record.instanceId, {
      registryId: record.instanceId,
      manifest: parsed,
      absPath: path.resolve(pluginDir),
      sourcePath: record.sourcePath,
      source: 'local',
      localFrom: record.from,
      mount: failedMount,
      message,
      installPrompt,
      preview: failedMount === 'preview-failed',
    });
    this.logger.error(`插件 ${parsed.id} 未能挂载: ${message}`);
  }

  private releaseOwned(owned: Owned): void {
    if (owned.instanceId) {
      const table = this.instanceServices.get(owned.instanceId);
      for (const name of owned.services) table?.delete(name);
    } else {
      for (const name of owned.services) {
        this.services.delete(name);
        this.hostServiceNames.delete(name);
      }
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
  const toolDirs = plugin.toolDirs ?? [];
  return {
    runtime: {
      ...bins,
      get env() {
        return runtimeEnv(prependToolDirs(pluginEnv(), toolDirs), bins);
      },
    },
  };
}

function summarizeProblem(problem: RuntimeProblem): PluginSummary {
  const summary = summarizePlugin({
    manifest: problem.manifest,
    absPath: problem.absPath,
    sourcePath: problem.sourcePath,
    source: problem.source,
    registryId: problem.registryId,
    localFrom: problem.localFrom,
    mount: problem.mount,
    apply: () => {},
  });
  if (problem.installPrompt) summary.installPrompt = problem.installPrompt;
  if (problem.preview) {
    summary.previewError = problem.message;
    summary.mount = 'preview-failed';
    return summary;
  }
  summary.runtimeError = problem.message;
  return summary;
}

function summarizePlugin(plugin: AppPlugin): PluginSummary {
  const manifest = plugin.manifest;
  const id = registryIdOf(plugin);
  const summary: PluginSummary = {
    id,
    manifestId: manifest.id,
    displayName: manifest.displayName,
    version: manifest.version,
    type: manifest.type,
    uiUrl:
      manifest.type === 'ui' && manifest.uiEntry
        ? `app-plugin://${id}/${manifest.uiEntry}`
        : null,
    source: plugin.source,
    rootPath: plugin.sourcePath ?? plugin.absPath,
    hasSettings: isSettingsCandidate(manifest),
  };
  if (plugin.source === 'local') {
    summary.instanceId = id;
    if (plugin.localFrom) summary.localFrom = plugin.localFrom;
    summary.mount = plugin.mount ?? 'source';
  }
  if (manifest.description) summary.description = manifest.description;
  if (manifest.icon) {
    const iconPath = manifest.icon.split(/[/\\]/).map((part) => encodeURIComponent(part)).join('/');
    summary.iconUrl = `app-plugin://${id}/${iconPath}`;
  }
  if (manifest.developer) summary.developer = manifest.developer;
  if (manifest.category) summary.category = manifest.category;
  if (manifest.website) summary.website = manifest.website;
  if (manifest.privacyPolicy) summary.privacyPolicy = manifest.privacyPolicy;
  if (manifest.termsOfService) summary.termsOfService = manifest.termsOfService;
  if (manifest.catalogError) summary.catalogError = manifest.catalogError;
  return summary;
}

function registryIdOf(plugin: AppPlugin): string {
  return plugin.registryId ?? plugin.manifest.id;
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
