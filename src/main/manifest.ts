import fs from 'node:fs';
import path from 'node:path';
import type { ConfigField, ConfigFieldType, ConfigSchema, PluginConfigValue, PluginManifest } from './types.ts';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const FIELD_TYPES = new Set<ConfigFieldType>(['string', 'boolean', 'number', 'select', 'path']);

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
  const settingsEntry = optionalRelative(raw.settingsEntry, 'settingsEntry');
  if (raw.type === 'ui' && !uiEntry) {
    throw new Error('ui 插件必须提供 uiEntry');
  }
  const parsedSchema = parseConfigSchema(raw.configSchema);
  const manifest: PluginManifest = {
    id: raw.id,
    displayName: raw.displayName.trim(),
    version: raw.version.trim(),
    type: raw.type,
    main,
    uiEntry,
  };
  if (settingsEntry) manifest.settingsEntry = settingsEntry;
  if (parsedSchema.schema) manifest.configSchema = parsedSchema.schema;
  if (parsedSchema.error) manifest.configSchemaError = parsedSchema.error;
  return manifest;
}

function parseConfigSchema(value: unknown): { schema?: ConfigSchema; error?: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'configSchema 必须是对象' };
  }
  const schema: ConfigSchema = {};
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      return { error: `配置项 ${key} 的键名无效` };
    }
    const parsed = parseConfigField(key, fieldValue);
    if (typeof parsed === 'string') return { error: parsed };
    schema[key] = parsed;
  }
  return { schema };
}

function parseConfigField(key: string, value: unknown): ConfigField | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `配置项 ${key} 必须是对象`;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !FIELD_TYPES.has(raw.type as ConfigFieldType)) {
    return `配置项 ${key} 的类型无效`;
  }
  const type = raw.type as ConfigFieldType;
  if (typeof raw.title !== 'string' || raw.title.trim() === '') {
    return `配置项 ${key} 缺少标题`;
  }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    return `配置项 ${key} 的说明无效`;
  }
  if (raw.secret !== undefined && typeof raw.secret !== 'boolean') {
    return `配置项 ${key} 的 secret 无效`;
  }
  if (raw.secret === true && type !== 'string') {
    return `配置项 ${key} 只有字符串可以设为密钥`;
  }
  if (raw.options !== undefined && type !== 'select') {
    return `配置项 ${key} 不能包含选项`;
  }

  const field: ConfigField = { type, title: raw.title.trim() };
  if (typeof raw.description === 'string' && raw.description.trim() !== '') {
    field.description = raw.description.trim();
  }
  if (raw.secret === true) field.secret = true;

  if (type === 'select') {
    const options = readSelectOptions(key, raw.options);
    if (typeof options === 'string') return options;
    if (typeof raw.default !== 'string' || raw.default.trim() === '' || !options.includes(raw.default.trim())) {
      return `配置项 ${key} 的默认值必须是选项之一`;
    }
    field.options = options;
    field.default = raw.default.trim();
    return field;
  }

  if (raw.default !== undefined) {
    if (!defaultMatches(type, raw.default)) {
      return `配置项 ${key} 的默认值类型不正确`;
    }
    field.default = raw.default as PluginConfigValue;
  }
  return field;
}

function readSelectOptions(key: string, value: unknown): string[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return `配置项 ${key} 的选项必须是非空字符串`;
  }
  const options: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      return `配置项 ${key} 的选项必须是非空字符串`;
    }
    options.push(item.trim());
  }
  return options;
}

function defaultMatches(type: ConfigFieldType, value: unknown): boolean {
  if (type === 'string' || type === 'path') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return false;
}

export function readManifestFile(pluginDir: string): PluginManifest {
  const manifestPath = path.join(pluginDir, 'plugin.manifest.json');
  const text = fs.readFileSync(manifestPath, 'utf8');
  return parseManifest(JSON.parse(text) as unknown);
}
