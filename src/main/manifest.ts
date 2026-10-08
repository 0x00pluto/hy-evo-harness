import fs from 'node:fs';
import path from 'node:path';
import type { PluginManifest } from './types.ts';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isPluginId(value: string): boolean {
  return ID_PATTERN.test(value);
}

function optionalRelative(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`manifest.${field} 无效`);
  }
  if (path.isAbsolute(value) || value.split(/[/\\]/).includes('..')) {
    throw new Error(`manifest.${field} 必须是插件目录内的相对路径`);
  }
  return value;
}

export function parseManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('manifest 不是对象');
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !isPluginId(raw.id)) {
    throw new Error('manifest.id 必须是小写字母、数字和连字符');
  }
  if (typeof raw.displayName !== 'string' || raw.displayName.trim() === '') {
    throw new Error('manifest.displayName 不能为空');
  }
  if (typeof raw.version !== 'string' || raw.version.trim() === '') {
    throw new Error('manifest.version 不能为空');
  }
  if (raw.type !== 'ui' && raw.type !== 'headless') {
    throw new Error('manifest.type 必须是 ui 或 headless');
  }
  const main = optionalRelative(raw.main, 'main');
  const uiEntry = optionalRelative(raw.uiEntry, 'uiEntry');
  if (raw.type === 'ui' && !uiEntry) {
    throw new Error('ui 插件必须提供 uiEntry');
  }
  return {
    id: raw.id,
    displayName: raw.displayName.trim(),
    version: raw.version.trim(),
    type: raw.type,
    main,
    uiEntry,
  };
}

export function readManifestFile(pluginDir: string): PluginManifest {
  const manifestPath = path.join(pluginDir, 'plugin.manifest.json');
  const text = fs.readFileSync(manifestPath, 'utf8');
  return parseManifest(JSON.parse(text) as unknown);
}
