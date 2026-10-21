import { compareSemver, isSemver, type PluginRelease } from './plugin-catalog.ts';
import {
  comparePluginId,
  planSilentPluginUpdates,
  type PluginOriginRecord,
} from './plugin-origins.ts';
import type { PluginSummary } from './types.ts';

/** 与应用自身更新同一长度，计时器分开，避免应用已可安装时插件不再检查。 */
export const PLUGIN_SILENT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface InstallLock {
  isLocked(): boolean;
  run<T>(task: () => Promise<T>): Promise<T>;
  tryRun<T>(task: () => Promise<T>): Promise<T | { ignored: true }>;
}

export function createInstallLock(): InstallLock {
  let chain: Promise<void> = Promise.resolve();
  let active = 0;

  function run<T>(task: () => Promise<T>): Promise<T> {
    active += 1;
    const result = chain.then(task, task);
    chain = result.then(() => {
      active -= 1;
    }, () => {
      active -= 1;
    });
    return result;
  }

  return {
    isLocked() {
      return active > 0;
    },
    run,
    tryRun<T>(task: () => Promise<T>): Promise<T | { ignored: true }> {
      if (active > 0) return Promise.resolve({ ignored: true });
      return run(task);
    },
  };
}

export interface SilentInstallResult {
  ok: boolean;
  message?: string;
  plugins: PluginSummary[];
  installedId?: string;
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

export interface PluginSilentUpdateHost {
  fetchCatalog(): Promise<{ plugins: PluginRelease[] }>;
  readInstalled(): Array<{ id: string; version: string; source: string }>;
  readOrigins(): Record<string, PluginOriginRecord>;
  installRelease(release: PluginRelease): Promise<SilentInstallResult>;
  send(event: SilentUpdateEvent): void;
}

export interface PluginSilentUpdates {
  setWatching(id: string | null): void;
  cancel(id: string): void;
  noteManualInstall(id: string): void;
  runRound(): Promise<void>;
  whenIdle(): Promise<void>;
}

export function createPluginSilentUpdates(host: PluginSilentUpdateHost, lock: InstallLock): PluginSilentUpdates {
  let watchingId: string | null = null;
  let roundRunning = false;
  let pendingRound = false;
  let draining = false;
  let batchOpen = false;
  let pendingId: string | null = null;
  let currentId: string | null = null;
  const deferred = new Map<string, PluginRelease>();
  const dropped = new Set<string>();
  let queue: PluginRelease[] = [];
  let pumpTail: Promise<void> = Promise.resolve();
  let roundTail: Promise<void> = Promise.resolve();

  function stillHigher(release: PluginRelease): boolean {
    const installed = host.readInstalled().find((plugin) => plugin.id === release.id);
    if (!installed || installed.source !== 'installed' || !isSemver(installed.version)) return false;
    const origin = host.readOrigins()[release.id];
    if (!origin || origin.channel !== 'market') return false;
    const order = compareSemver(release.version, installed.version);
    return order !== null && order > 0;
  }

  function dropQueued(id: string): void {
    deferred.delete(id);
    queue = queue.filter((plugin) => plugin.id !== id);
    if (pendingId === id || currentId === id) dropped.add(id);
  }

  function enqueueRelease(release: PluginRelease): void {
    if (release.id === pendingId || release.id === currentId) return;
    if (queue.some((plugin) => plugin.id === release.id)) return;
    queue.push(release);
    queue.sort((left, right) => comparePluginId(left.id, right.id));
    schedulePump();
  }

  function schedulePump(): void {
    pumpTail = pumpTail.then(() => drain());
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        const plugin = queue.shift();
        if (!plugin) break;
        await installOne(plugin);
      }
    } finally {
      draining = false;
    }
    if (queue.length > 0) {
      schedulePump();
      return;
    }
    if (batchOpen) {
      batchOpen = false;
      host.send({ phase: 'idle' });
    }
  }

  async function installOne(release: PluginRelease): Promise<void> {
    pendingId = release.id;
    try {
      await lock.run(async () => {
        if (dropped.has(release.id)) return;
        if (watchingId === release.id) {
          deferred.set(release.id, release);
          return;
        }
        if (!stillHigher(release)) return;
        currentId = release.id;
        batchOpen = true;
        host.send({ phase: 'start', id: release.id });
        try {
          const outcome = await host.installRelease(release);
          if (dropped.has(release.id)) return;
          host.send({
            phase: 'result',
            id: release.id,
            ok: outcome.ok,
            message: outcome.message,
            plugins: outcome.plugins,
            installedId: outcome.installedId,
          });
        } catch (err) {
          if (dropped.has(release.id)) return;
          host.send({
            phase: 'result',
            id: release.id,
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          if (currentId === release.id) currentId = null;
        }
      });
    } finally {
      if (pendingId === release.id) pendingId = null;
      dropped.delete(release.id);
    }
  }

  function whenPumpIdle(): Promise<void> {
    const pending = pumpTail;
    return pending.then(() => {
      if (pending === pumpTail) return undefined;
      return whenPumpIdle();
    });
  }

  function whenIdle(): Promise<void> {
    const round = roundTail;
    const pump = pumpTail;
    return Promise.all([round, pump]).then(() => {
      if (round === roundTail && pump === pumpTail) return undefined;
      return whenIdle();
    });
  }

  async function runRounds(): Promise<void> {
    do {
      pendingRound = false;
      let catalog: { plugins: PluginRelease[] };
      try {
        catalog = await host.fetchCatalog();
      } catch {
        // 目录失败不安装；离开又排了一轮时再试一次。
        continue;
      }
      const plan = planSilentPluginUpdates({
        catalog: catalog.plugins,
        origins: host.readOrigins(),
        installed: host.readInstalled(),
        watchingId,
      });
      const nextDeferred = new Map<string, PluginRelease>();
      for (const id of plan.defer) {
        const plugin = catalog.plugins.find((item) => item.id === id);
        if (plugin) nextDeferred.set(id, plugin);
      }
      deferred.clear();
      for (const [id, plugin] of nextDeferred) deferred.set(id, plugin);
      for (const id of plan.install) {
        const plugin = catalog.plugins.find((item) => item.id === id);
        if (plugin) enqueueRelease(plugin);
      }
      await whenPumpIdle();
    } while (pendingRound);
  }

  function runRound(): Promise<void> {
    if (roundRunning) {
      pendingRound = true;
      return roundTail;
    }
    roundRunning = true;
    const work = runRounds().finally(() => {
      roundRunning = false;
      // while 已退出与清标志之间又有人要求再查时，立刻开下一轮。
      if (pendingRound) return runRound();
    });
    roundTail = roundTail.then(() => work, () => work);
    return work;
  }

  return {
    setWatching(id: string | null): void {
      const next = id && id.trim() !== '' ? id : null;
      const previous = watchingId;
      if (previous === next) return;
      watchingId = next;
      if (!previous) return;
      const plugin = deferred.get(previous);
      if (plugin) {
        deferred.delete(previous);
        enqueueRelease(plugin);
      }
      // 离开正在看的插件时再读目录，会话中途发布的更高版本不用等重启或满 6 小时。
      void runRound();
    },
    cancel(id: string): void {
      dropQueued(id);
    },
    noteManualInstall(id: string): void {
      dropQueued(id);
    },
    runRound,
    whenIdle,
  };
}
