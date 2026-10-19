import fs from 'node:fs';
import path from 'node:path';
import { instanceIdForPath, sameDirectory } from './instance-id.ts';
import { filesForPack } from './plugin-pack.ts';
import type { ServiceRegistry } from './registry.ts';
import type { LocalRecord, Logger, PluginSummary } from './types.ts';
import {
  discoverPluginRoots,
  inspectDirectory,
  instanceDataPaths,
  pathsAfterRemoval,
  previewDir,
  readUnpackedPaths,
  writeUnpackedPaths,
  type LocalRoot,
} from './unpacked-plugins.ts';

export interface LocalSessionOptions {
  registry: ServiceRegistry;
  userData: string;
  unpackedFile: string;
  logger?: Logger;
}

export interface AddDirectoryResult {
  ok: boolean;
  already?: boolean;
  message?: string;
  focusedId?: string;
  plugins: PluginSummary[];
}

/**
 * 插件页登记的目录，以及未打包时 config.dev.json 里的路径。
 * 两者都按实例 id 挂载。配置文件里的路径不能从界面移除。
 */
export class LocalSession {
  private readonly registry: ServiceRegistry;
  private readonly userData: string;
  private readonly unpackedFile: string;
  private readonly logger: Logger;

  constructor(options: LocalSessionOptions) {
    this.registry = options.registry;
    this.userData = options.userData;
    this.unpackedFile = options.unpackedFile;
    this.logger = options.logger ?? options.registry.logger;
  }

  /** 启动时加载。单个目录失败只记日志，不打断其余路径。 */
  async loadPaths(paths: readonly string[], from: LocalRecord['from']): Promise<void> {
    for (const registeredPath of paths) {
      const roots = discoverPluginRoots(registeredPath);
      if (roots.length === 0) {
        this.logger.error(`本地目录里没有插件: ${registeredPath}`);
        continue;
      }
      for (const sourcePath of roots) {
        await this.mountRoot({
          sourcePath,
          registeredPath,
          from,
          mount: 'source',
        });
      }
    }
  }

  async loadRegistered(): Promise<void> {
    await this.loadPaths(readUnpackedPaths(this.unpackedFile), 'page');
  }

  async addDirectory(picked: string): Promise<AddDirectoryResult> {
    const inspection = inspectDirectory(picked, this.registry.manifestIds());
    if (!inspection.ok) {
      return { ok: false, message: inspection.message, plugins: this.registry.getPluginList() };
    }
    const already = this.alreadyLoaded(inspection.registeredPath, inspection.roots);
    if (already) {
      return {
        ok: true,
        already: true,
        focusedId: already,
        plugins: this.registry.getPluginList(),
      };
    }
    const paths = readUnpackedPaths(this.unpackedFile);
    if (!paths.some((item) => sameDirectory(item, inspection.registeredPath))) {
      writeUnpackedPaths(this.unpackedFile, [...paths, inspection.registeredPath]);
    }
    let focusedId = inspection.roots[0]?.instanceId;
    for (const root of inspection.roots) {
      const message = await this.mountRoot({
        sourcePath: root.sourcePath,
        instanceId: root.instanceId,
        manifestId: root.manifestId,
        registeredPath: inspection.registeredPath,
        from: 'page',
        mount: 'source',
      });
      if (message && inspection.roots.length === 1) {
        return { ok: false, message, focusedId: root.instanceId, plugins: this.registry.getPluginList() };
      }
      focusedId = root.instanceId;
    }
    return { ok: true, focusedId, plugins: this.registry.getPluginList() };
  }

  async reload(instanceId: string): Promise<PluginSummary[]> {
    const record = this.requireLocal(instanceId);
    await this.registry.unloadPlugin(instanceId);
    if (record.mount === 'preview' || record.mount === 'preview-failed') {
      fs.rmSync(previewDir(this.userData, instanceId), { recursive: true, force: true });
    }
    const message = await this.registry.mountLocal({
      record: { ...record, mount: 'source', previewError: undefined },
      pluginDir: record.sourcePath,
      layout: 'repo',
    });
    if (message) throw new Error(message);
    return this.registry.getPluginList();
  }

  async startPreview(instanceId: string): Promise<AddDirectoryResult> {
    const record = this.registry.getLocal(instanceId);
    if (!record || record.from !== 'page') {
      throw new Error('只能预览从插件页加载的本地目录');
    }
    if (record.mount === 'preview') {
      throw new Error('已经在发布预览中');
    }
    await this.registry.unloadPlugin(instanceId);
    const dest = previewDir(this.userData, instanceId);
    try {
      copyPackedTree(record.sourcePath, dest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.registry.failPreview(record, message);
      return { ok: false, message, plugins: this.registry.getPluginList() };
    }
    const message = await this.registry.mountLocal({
      record: { ...record, mount: 'preview', previewError: undefined },
      pluginDir: dest,
      layout: 'published',
    });
    if (message) {
      return { ok: false, message, plugins: this.registry.getPluginList() };
    }
    return { ok: true, plugins: this.registry.getPluginList() };
  }

  async endPreview(instanceId: string): Promise<PluginSummary[]> {
    const record = this.registry.getLocal(instanceId);
    if (!record || record.from !== 'page') {
      throw new Error('只能结束从插件页加载的预览');
    }
    await this.registry.unloadPlugin(instanceId);
    fs.rmSync(previewDir(this.userData, instanceId), { recursive: true, force: true });
    const message = await this.registry.mountLocal({
      record: { ...record, mount: 'source', previewError: undefined },
      pluginDir: record.sourcePath,
      layout: 'repo',
    });
    if (message) throw new Error(message);
    return this.registry.getPluginList();
  }

  async remove(instanceId: string): Promise<PluginSummary[]> {
    const record = this.registry.getLocal(instanceId);
    if (!record || record.from !== 'page') {
      throw new Error('只能移除从插件页加载的本地目录');
    }
    await this.registry.unloadPlugin(instanceId);
    const targets = instanceDataPaths(this.userData, instanceId);
    fs.rmSync(targets.runtimeDir, { recursive: true, force: true });
    fs.rmSync(targets.dataDir, { recursive: true, force: true });
    fs.rmSync(targets.previewDir, { recursive: true, force: true });
    this.registry.deletePluginSettings(instanceId);
    const siblings = this.registry.listLocals()
      .filter((item) => item.instanceId !== instanceId && sameDirectory(item.registeredPath, record.registeredPath));
    const next = pathsAfterRemoval(
      readUnpackedPaths(this.unpackedFile),
      record.registeredPath,
      record.sourcePath,
      siblings.map((item) => item.sourcePath),
    );
    writeUnpackedPaths(this.unpackedFile, next);
    for (const sibling of siblings) {
      this.registry.noteRegisteredPath(sibling.instanceId, sibling.sourcePath);
    }
    this.registry.clearLocal(instanceId);
    return this.registry.getPluginList();
  }

  private alreadyLoaded(registeredPath: string, roots: readonly LocalRoot[]): string | undefined {
    const registered = readUnpackedPaths(this.unpackedFile);
    if (registered.some((item) => sameDirectory(item, registeredPath))) {
      const match = this.registry.listLocals().find((item) =>
        sameDirectory(item.registeredPath, registeredPath) || roots.some((root) => root.instanceId === item.instanceId),
      );
      return match?.instanceId ?? roots[0]?.instanceId;
    }
    if (roots.length > 0 && roots.every((root) => this.registry.getLocal(root.instanceId))) {
      return roots[0]?.instanceId;
    }
    return undefined;
  }

  private requireLocal(instanceId: string): LocalRecord {
    const record = this.registry.getLocal(instanceId);
    if (!record) {
      throw new Error('只能重新加载本地目录');
    }
    return record;
  }

  private async mountRoot(input: {
    sourcePath: string;
    registeredPath: string;
    from: LocalRecord['from'];
    mount: LocalRecord['mount'];
    instanceId?: string;
    manifestId?: string;
  }): Promise<string | null> {
    const instanceId = input.instanceId ?? instanceIdForPath(input.sourcePath);
    if (this.registry.getLocal(instanceId) || this.registry.hasRegistryId(instanceId)) {
      return null;
    }
    if (this.registry.manifestIds().has(instanceId)) {
      const message = `实例 id 与已加载插件 ${instanceId} 相同，已拒绝`;
      this.logger.error(message);
      return message;
    }
    const message = await this.registry.mountLocal({
      record: {
        instanceId,
        manifestId: input.manifestId ?? '',
        sourcePath: input.sourcePath,
        registeredPath: input.registeredPath,
        from: input.from,
        mount: input.mount,
      },
      pluginDir: input.sourcePath,
      layout: 'repo',
    });
    if (message) this.logger.error(message);
    return message;
  }
}

export function copyPackedTree(source: string, dest: string): void {
  const files = filesForPack(source);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const relative of files) {
    const from = path.join(source, ...relative.split('/'));
    const to = path.join(dest, ...relative.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
