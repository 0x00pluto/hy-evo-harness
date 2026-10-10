import fs from 'node:fs';
import path from 'node:path';
import { isPluginId } from './manifest.ts';
import { compareSemver, isSemver, type PluginRelease } from './plugin-catalog.ts';

export type PluginOriginChannel = 'market' | 'file';

export interface PluginOriginRecord {
  channel: PluginOriginChannel;
  version: string;
  sha256?: string;
  installedAt: string;
}

export interface PluginUpdateNotice {
  id: string;
  version: string;
  remoteVersion: string;
}

export function readOrigins(filePath: string): Record<string, PluginOriginRecord> {
  if (!fs.existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const origins: Record<string, PluginOriginRecord> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const record = parseOrigin(id, value);
    if (record) origins[id] = record;
  }
  return origins;
}

export function writeOrigin(filePath: string, id: string, record: PluginOriginRecord): void {
  if (!isPluginId(id)) throw new Error('插件 id 无效');
  const origins = readOrigins(filePath);
  origins[id] = record;
  writeOrigins(filePath, origins);
}

export function deleteOrigin(filePath: string, id: string): void {
  const origins = readOrigins(filePath);
  if (!Object.prototype.hasOwnProperty.call(origins, id)) return;
  delete origins[id];
  writeOrigins(filePath, origins);
}

export function marketUpdates(options: {
  catalog: PluginRelease[];
  origins: Record<string, PluginOriginRecord>;
  installed: Array<{ id: string; version: string; source: string }>;
}): PluginUpdateNotice[] {
  const notices: PluginUpdateNotice[] = [];
  for (const plugin of options.installed) {
    if (plugin.source !== 'installed') continue;
    const origin = options.origins[plugin.id];
    if (!origin || origin.channel !== 'market') continue;
    const remote = options.catalog.find((item) => item.id === plugin.id);
    if (!remote || !isSemver(plugin.version)) continue;
    const order = compareSemver(remote.version, plugin.version);
    if (order !== null && order > 0) {
      notices.push({ id: plugin.id, version: plugin.version, remoteVersion: remote.version });
    }
  }
  return notices;
}

function parseOrigin(id: string, value: unknown): PluginOriginRecord | null {
  if (!isPluginId(id) || !value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.channel !== 'market' && raw.channel !== 'file') return null;
  if (typeof raw.version !== 'string' || raw.version.trim() === '') return null;
  if (typeof raw.installedAt !== 'string' || raw.installedAt.trim() === '') return null;
  const record: PluginOriginRecord = {
    channel: raw.channel,
    version: raw.version.trim(),
    installedAt: raw.installedAt,
  };
  if (typeof raw.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(raw.sha256)) {
    record.sha256 = raw.sha256.toLowerCase();
  }
  return record;
}

function writeOrigins(filePath: string, origins: Record<string, PluginOriginRecord>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(origins, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}
