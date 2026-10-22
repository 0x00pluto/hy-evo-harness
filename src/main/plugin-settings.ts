import fs from 'node:fs';
import path from 'node:path';
import type {
  SettingsFieldView,
  SettingsPluginView,
  SettingsSaveResult,
} from '../shared/dex-bridge.ts';
import type {
  AppPlugin,
  ConfigField,
  ConfigSchema,
  Logger,
  PluginConfig,
  PluginConfigValue,
  PluginManifest,
  PluginSource,
} from './types.ts';

export type { SettingsFieldView, SettingsPluginView, SettingsSaveResult };

type SettingsFile = Record<string, Record<string, PluginConfigValue>>;

const UNREADABLE = 'plugin-settings.json 无法读取，已按空配置启动';

export class PluginSettingsStore {
  private memory: SettingsFile = {};
  private readonly filePath: string | null;
  private readonly logger: Logger;

  constructor(filePath: string | null, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger;
  }

  getPluginConfig(manifest: PluginManifest, storageId = manifest.id): PluginConfig {
    if (!manifest.configSchema || manifest.configSchemaError) return {};
    const saved = this.read()[storageId] ?? {};
    return mergeConfig(manifest.configSchema, saved);
  }

  /**
   * 返回新对象。调用方拿去传给子进程，不能写回宿主环境。
   */
  pluginEnv(manifest: PluginManifest, base: NodeJS.ProcessEnv, storageId = manifest.id): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base };
    for (const [key, value] of Object.entries(this.getPluginConfig(manifest, storageId))) {
      env[key] = stringifyConfigValue(value);
    }
    return env;
  }

  listViews(plugins: AppPlugin[]): SettingsPluginView[] {
    return plugins.filter((plugin) => isSettingsCandidate(plugin.manifest)).map((plugin) => this.viewFor(plugin));
  }

  viewFor(plugin: AppPlugin): SettingsPluginView {
    const manifest = plugin.manifest;
    const storageId = plugin.registryId ?? manifest.id;
    const fields: SettingsFieldView[] = [];
    if (manifest.configSchema && !manifest.configSchemaError) {
      const saved = this.read()[storageId] ?? {};
      const merged = mergeConfig(manifest.configSchema, saved);
      for (const [key, field] of Object.entries(manifest.configSchema)) {
        fields.push(toFieldView(key, field, merged));
      }
    }
    const view: SettingsPluginView = {
      id: storageId,
      displayName: manifest.displayName,
      source: plugin.source,
      settingsEntryUrl: manifest.settingsEntry
        ? `app-plugin://${storageId}/${manifest.settingsEntry}`
        : null,
      schemaError: manifest.configSchemaError ?? null,
      fields,
    };
    const iconUrl = catalogIconUrl(manifest, storageId);
    if (iconUrl) view.iconUrl = iconUrl;
    return view;
  }

  /**
   * 只给出已加载插件里密钥字段的当前生效值。非密钥字段不返回。
   * 调用方不要把返回值写进日志。
   */
  reveal(manifest: PluginManifest, key: string, storageId = manifest.id): { ok: true; value: string } | { ok: false } {
    const schema = manifest.configSchema;
    if (!schema || manifest.configSchemaError) return { ok: false };
    const field = schema[key];
    if (!field || field.secret !== true) return { ok: false };
    const value = this.getPluginConfig(manifest, storageId)[key];
    return { ok: true, value: typeof value === 'string' ? value : '' };
  }

  save(manifest: PluginManifest, draft: unknown, storageId = manifest.id): SettingsSaveResult {
    if (manifest.configSchemaError) {
      return { ok: false, message: manifest.configSchemaError };
    }
    if (!manifest.configSchema || Object.keys(manifest.configSchema).length === 0) {
      return { ok: false, message: '该插件没有可保存的配置' };
    }
    const all = this.read();
    const normalized = normalizeDraft(manifest.configSchema, all[storageId] ?? {}, draft);
    if (!normalized.ok) return normalized;
    all[storageId] = normalized.values;
    try {
      this.write(all);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`配置写入失败: ${message}`);
      return { ok: false, message: '配置写入失败' };
    }
    return { ok: true };
  }

  deletePlugin(id: string): void {
    const all = this.read();
    if (!Object.prototype.hasOwnProperty.call(all, id)) return;
    delete all[id];
    this.write(all);
  }

  private read(): SettingsFile {
    const source = this.filePath === null ? this.memory : this.readFromDisk();
    return structuredClone(source);
  }

  private readFromDisk(): SettingsFile {
    if (!this.filePath || !fs.existsSync(this.filePath)) return {};
    let text: string;
    try {
      text = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      // 异常原文可能带上文件片段，这里只记固定句子。
      this.logger.error(UNREADABLE);
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.logger.error(UNREADABLE);
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.logger.error(UNREADABLE);
      return {};
    }
    const result: SettingsFile = {};
    for (const [id, block] of Object.entries(parsed as Record<string, unknown>)) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
      const clean: Record<string, PluginConfigValue> = {};
      for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
        if (isConfigValue(value)) clean[key] = value;
      }
      result[id] = clean;
    }
    return result;
  }

  private write(data: SettingsFile): void {
    if (this.filePath === null) {
      this.memory = structuredClone(data);
      return;
    }
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    try {
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }
}

/** 旧安装包里随应用出现的两份示例。新示例不在这份名单里。 */
const LEGACY_EXAMPLE_PLUGIN_IDS = ['ai-comic-master', 'quanmedia-crawl'] as const;

export interface LoadedPluginRef {
  source: PluginSource;
  manifestId: string;
}

/**
 * 三条同时成立才返回该清单 id：没有 bundled、installed_plugins 里没有、已加载的本地实例里也没有。
 * 调用方再用按 id 删除设置，其它键（含 dev- 开头的实例 id）不动。
 */
export function exampleSettingIdsToDrop(input: {
  loaded: ReadonlyArray<LoadedPluginRef>;
  installedIds: ReadonlyArray<string>;
}): string[] {
  const installed = new Set(input.installedIds);
  return LEGACY_EXAMPLE_PLUGIN_IDS.filter((id) => {
    const hasBundled = input.loaded.some((plugin) => plugin.source === 'bundled' && plugin.manifestId === id);
    const hasLocal = input.loaded.some((plugin) => plugin.source === 'local' && plugin.manifestId === id);
    return !hasBundled && !installed.has(id) && !hasLocal;
  });
}

export function isSettingsCandidate(manifest: PluginManifest): boolean {
  if (manifest.configSchemaError) return true;
  if (manifest.settingsEntry) return true;
  return Boolean(manifest.configSchema && Object.keys(manifest.configSchema).length > 0);
}

function mergeConfig(schema: ConfigSchema, saved: Record<string, PluginConfigValue>): PluginConfig {
  const result: PluginConfig = {};
  for (const [key, field] of Object.entries(schema)) {
    const stored = saved[key];
    if (valueMatches(field, stored)) {
      result[key] = stored;
      continue;
    }
    const fallback = fallbackValue(field);
    if (fallback !== undefined) result[key] = fallback;
  }
  return result;
}

function fallbackValue(field: ConfigField): PluginConfigValue | undefined {
  if (field.type === 'number') {
    return typeof field.default === 'number' && Number.isFinite(field.default) ? field.default : undefined;
  }
  if (field.type === 'boolean') {
    return typeof field.default === 'boolean' ? field.default : false;
  }
  return typeof field.default === 'string' ? field.default : '';
}

function valueMatches(field: ConfigField, value: unknown): value is PluginConfigValue {
  if (field.type === 'string' || field.type === 'path') return typeof value === 'string';
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'select') return typeof value === 'string' && (field.options ?? []).includes(value);
  return false;
}

function toFieldView(key: string, field: ConfigField, merged: PluginConfig): SettingsFieldView {
  const view: SettingsFieldView = {
    key,
    type: field.type,
    title: field.title,
  };
  if (field.description) view.description = field.description;
  if (field.group) view.group = field.group;
  if (field.options) view.options = field.options;
  if (field.default !== undefined) view.default = field.default;
  if (field.secret) {
    view.secret = true;
    const effective = merged[key];
    view.secretSet = typeof effective === 'string' && effective.length > 0;
    return view;
  }
  if (Object.prototype.hasOwnProperty.call(merged, key)) {
    view.value = merged[key];
  }
  return view;
}

function normalizeDraft(
  schema: ConfigSchema,
  existing: Record<string, PluginConfigValue>,
  draft: unknown,
): { ok: true; values: Record<string, PluginConfigValue> } | { ok: false; message: string } {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return { ok: false, message: '配置无效' };
  }
  const raw = draft as { values?: unknown; secrets?: unknown };
  if (!raw.values || typeof raw.values !== 'object' || Array.isArray(raw.values)) {
    return { ok: false, message: '配置无效' };
  }
  if (raw.secrets !== undefined && (typeof raw.secrets !== 'object' || raw.secrets === null || Array.isArray(raw.secrets))) {
    return { ok: false, message: '配置无效' };
  }
  const valuesIn = raw.values as Record<string, unknown>;
  const secretsIn = (raw.secrets ?? {}) as Record<string, unknown>;
  const next: Record<string, PluginConfigValue> = {};

  for (const [key, field] of Object.entries(schema)) {
    if (field.secret) {
      const resolved = resolveSecret(field, existing[key], secretsIn[key]);
      if (!resolved.ok) return { ok: false, message: `${field.title}不合法` };
      next[key] = resolved.value;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(valuesIn, key)) {
      return { ok: false, message: `${field.title}不合法` };
    }
    const checked = checkValue(field, valuesIn[key]);
    if (!checked.ok) return checked;
    next[key] = checked.value;
  }
  return { ok: true, values: next };
}

function resolveSecret(
  field: ConfigField,
  existing: PluginConfigValue | undefined,
  intent: unknown,
): { ok: true; value: string } | { ok: false } {
  const action = readSecretAction(intent);
  if (action === 'invalid') return { ok: false };
  if (action === 'clear') return { ok: true, value: '' };
  if (action === 'set') {
    const value = (intent as { value?: unknown }).value;
    if (typeof value !== 'string') return { ok: false };
    return { ok: true, value };
  }
  if (typeof existing === 'string') return { ok: true, value: existing };
  if (typeof field.default === 'string') return { ok: true, value: field.default };
  return { ok: true, value: '' };
}

function readSecretAction(intent: unknown): 'keep' | 'set' | 'clear' | 'invalid' {
  if (intent === undefined) return 'keep';
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return 'invalid';
  const action = (intent as { action?: unknown }).action;
  if (action === 'keep' || action === 'set' || action === 'clear') return action;
  return 'invalid';
}

function checkValue(
  field: ConfigField,
  value: unknown,
): { ok: true; value: PluginConfigValue } | { ok: false; message: string } {
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, message: `${field.title}不是有限数字` };
    }
    return { ok: true, value };
  }
  if (field.type === 'select') {
    if (typeof value !== 'string' || !(field.options ?? []).includes(value)) {
      return { ok: false, message: `${field.title}不在可选项内` };
    }
    return { ok: true, value };
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, message: `${field.title}不合法` };
    return { ok: true, value };
  }
  if (typeof value !== 'string') return { ok: false, message: `${field.title}不合法` };
  return { ok: true, value };
}

function catalogIconUrl(manifest: PluginManifest, storageId: string): string | undefined {
  if (!manifest.icon) return undefined;
  const iconPath = manifest.icon.split(/[/\\]/).map((part) => encodeURIComponent(part)).join('/');
  return `app-plugin://${storageId}/${iconPath}`;
}

function stringifyConfigValue(value: PluginConfigValue): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return value;
}

function isConfigValue(value: unknown): value is PluginConfigValue {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}
