import fs from 'node:fs';
import path from 'node:path';
import type { ConfigField, ConfigFieldType, ConfigSchema, PluginConfigValue, PluginManifest } from './types.ts';

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const FIELD_TYPES = new Set<ConfigFieldType>(['string', 'boolean', 'number', 'select', 'path']);
const ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const CATALOG_TEXT = [
  { key: 'description', max: 280 },
  { key: 'developer', max: 64 },
  { key: 'category', max: 32 },
] as const;
const CATALOG_URLS = ['website', 'privacyPolicy', 'termsOfService'] as const;

/** 只接受带主机名的 http(s)。目录字段另有长度限制，打开外链不再卡这层。 */
export function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.hostname.length > 0;
}

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
  const catalog = parseCatalog(raw);
  const manifest: PluginManifest = {
    id: raw.id,
    displayName: raw.displayName.trim(),
    version: raw.version.trim(),
    type: raw.type,
    main,
    uiEntry,
    ...catalog.fields,
  };
  if (settingsEntry) manifest.settingsEntry = settingsEntry;
  if (parsedSchema.schema) manifest.configSchema = parsedSchema.schema;
  if (parsedSchema.error) manifest.configSchemaError = parsedSchema.error;
  if (catalog.error) manifest.catalogError = catalog.error;
  return manifest;
}

function parseCatalog(raw: Record<string, unknown>): {
  fields: Pick<PluginManifest, 'description' | 'icon' | 'developer' | 'category' | 'website' | 'privacyPolicy' | 'termsOfService'>;
  error?: string;
} {
  const errors: string[] = [];
  const fields: Pick<PluginManifest, 'description' | 'icon' | 'developer' | 'category' | 'website' | 'privacyPolicy' | 'termsOfService'> = {};

  for (const { key, max } of CATALOG_TEXT) {
    const parsed = parseCatalogText(key, raw[key], max, errors);
    if (parsed) fields[key] = parsed;
  }
  const icon = parseCatalogIcon(raw.icon, errors);
  if (icon) fields.icon = icon;
  for (const key of CATALOG_URLS) {
    const parsed = parseCatalogUrl(key, raw[key], errors);
    if (parsed) fields[key] = parsed;
  }
  return { fields, error: errors.length > 0 ? errors.join('；') : undefined };
}

function parseCatalogText(
  key: string,
  value: unknown,
  max: number,
  errors: string[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${key} 必须是字符串`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > max) {
    errors.push(`${key} 须为 1–${max} 个字符`);
    return undefined;
  }
  return trimmed;
}

function parseCatalogIcon(value: unknown, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push('icon 必须是字符串');
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const extension = path.extname(trimmed).toLowerCase();
  if (path.isAbsolute(trimmed) || trimmed.split(/[/\\]/).includes('..') || !ICON_EXTENSIONS.has(extension)) {
    errors.push('icon 必须是插件目录内的 png、jpg、jpeg、webp 或 svg');
    return undefined;
  }
  return trimmed;
}

function parseCatalogUrl(key: string, value: unknown, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${key} 必须是字符串`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > 300 || !isHttpUrl(trimmed)) {
    errors.push(`${key} 须为不超过 300 字符的 http(s) 链接`);
    return undefined;
  }
  return trimmed;
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
  return attachCatalogIcon(parseManifest(JSON.parse(text) as unknown), pluginDir);
}

function attachCatalogIcon(manifest: PluginManifest, pluginDir: string): PluginManifest {
  if (!manifest.icon) return manifest;
  if (iconFileExists(pluginDir, manifest.icon)) return manifest;
  const next: PluginManifest = { ...manifest };
  delete next.icon;
  const missing = 'icon 文件不存在';
  next.catalogError = next.catalogError ? `${next.catalogError}；${missing}` : missing;
  return next;
}

function iconFileExists(pluginDir: string, icon: string): boolean {
  const root = path.resolve(pluginDir);
  const target = path.resolve(root, icon);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}
