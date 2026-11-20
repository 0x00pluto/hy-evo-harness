/** 插件页诊断：状态优先级与复制文本（纯函数）。信号来自 Electron / 协议事件，不做空页探测。 */

export const STATUS_SUBRESOURCE = '插件页面有文件没加载到';
export const STATUS_CONSOLE = '插件页面报错';

export const CONSOLE_RING = 30;

/** Electron console-message：0 verbose、1 info、2 warning、3 error。 */
export const CONSOLE_LEVEL_WARNING = 2;
export const CONSOLE_LEVEL_ERROR = 3;

const CACHE_NOTE = '更新只清 HTTP 缓存，不清插件页面自己的本地数据（如 localStorage）';

/**
 * @typedef {{
 *   url: string;
 *   kind?: string;
 *   resourceType?: string;
 *   error?: string;
 * }} AssetFailure
 *
 * @typedef {{
 *   level: number;
 *   message: string;
 *   sourceId?: string;
 *   line?: number;
 * }} ConsoleEntry
 *
 * @typedef {{
 *   openFailure?: string | null;
 *   assetFailures: readonly AssetFailure[];
 *   consoleEntries: readonly ConsoleEntry[];
 *   guestGone?: string | null;
 * }} DiagnosticSignals
 *
 * @typedef {{
 *   hostVersion: string;
 *   system: string;
 *   pluginId: string;
 *   pluginVersion: string;
 *   pluginSource: string;
 * }} DiagnosticMeta
 *
 * @typedef {{ kind: 'asset' | 'console' | 'openFailure' | 'guestGone'; message: string }} DiagnosticStatus
 */

/**
 * @param {number} level
 */
export function isConsoleDiagnosable(level) {
  return level === CONSOLE_LEVEL_WARNING || level === CONSOLE_LEVEL_ERROR;
}

/**
 * Electron 开发态对无严格 CSP 的 guest 几乎都会打这条；打包后不出现。不算插件报错。
 *
 * @param {ConsoleEntry} entry
 */
export function isIgnoredConsoleNoise(entry) {
  const sourceId = typeof entry.sourceId === 'string' ? entry.sourceId : '';
  const message = typeof entry.message === 'string' ? entry.message : '';
  if (sourceId.includes('sandbox_bundle')) return true;
  if (message.includes('Electron Security Warning')) return true;
  return false;
}

/**
 * @param {readonly ConsoleEntry[]} entries
 * @param {ConsoleEntry} entry
 * @param {number} [limit]
 * @returns {ConsoleEntry[]}
 */
export function pushConsoleRing(entries, entry, limit = CONSOLE_RING) {
  if (!isConsoleDiagnosable(entry.level)) return [...entries];
  if (isIgnoredConsoleNoise(entry)) return [...entries];
  const next = entries.concat(entry);
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

/**
 * @param {readonly AssetFailure[]} failures
 * @param {AssetFailure} failure
 * @param {number} [limit]
 * @returns {AssetFailure[]}
 */
export function pushAssetFailure(failures, failure, limit = CONSOLE_RING) {
  const url = typeof failure.url === 'string' ? failure.url : '';
  if (!url) return [...failures];
  const next = failures.filter((item) => item.url !== url).concat({
    url,
    kind: failure.kind,
    resourceType: failure.resourceType,
    error: failure.error,
  });
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

/**
 * 稳定指纹：同信号关条后不反复打扰；内容一变再弹出。
 *
 * @param {DiagnosticSignals} signals
 */
export function diagnosticFingerprint(signals) {
  const assets = signals.assetFailures
    .map((item) => item.url || '')
    .filter(Boolean)
    .slice()
    .sort()
    .join('\n');
  const consoles = signals.consoleEntries
    .map((entry) => [
      entry.level,
      entry.message || '',
      entry.sourceId || '',
      typeof entry.line === 'number' ? entry.line : '',
    ].join('\t'))
    .join('\n');
  return [
    signals.openFailure || '',
    signals.guestGone || '',
    assets,
    consoles,
  ].join('\0');
}

/**
 * @param {DiagnosticSignals} signals
 * @returns {DiagnosticStatus | null}
 */
export function diagnoseStatus(signals) {
  if (signals.openFailure) {
    return { kind: 'openFailure', message: signals.openFailure };
  }
  if (signals.guestGone) {
    return { kind: 'guestGone', message: signals.guestGone };
  }
  if (signals.assetFailures.length > 0) {
    return { kind: 'asset', message: STATUS_SUBRESOURCE };
  }
  if (signals.consoleEntries.some((entry) => isConsoleDiagnosable(entry.level))) {
    return { kind: 'console', message: STATUS_CONSOLE };
  }
  return null;
}

/**
 * @param {number} level
 */
function consoleLevelLabel(level) {
  if (level === CONSOLE_LEVEL_ERROR) return 'error';
  if (level === CONSOLE_LEVEL_WARNING) return 'warning';
  return String(level);
}

/**
 * @param {DiagnosticMeta} meta
 * @param {DiagnosticSignals} signals
 */
export function formatDiagnosticText(meta, signals) {
  const status = diagnoseStatus(signals);
  const phase = signals.openFailure
    ? `打开失败：${signals.openFailure}`
    : signals.guestGone
      ? `访客进程：${signals.guestGone}`
      : '主帧与样式已通过（遮罩已收起）或仍在打开';

  const lines = [
    'Dex Buddy 插件页诊断',
    `宿主版本：${meta.hostVersion || '（未知）'}`,
    `系统：${meta.system || '（未知）'}`,
    `插件：${meta.pluginId || '（未知）'}`,
    `插件版本：${meta.pluginVersion || '（未知）'}`,
    `来源：${meta.pluginSource || '（未知）'}`,
    `加载阶段：${phase}`,
    `状态：${status ? status.message : '（无）'}`,
    CACHE_NOTE,
  ];

  if (signals.assetFailures.length > 0) {
    lines.push('资源失败：');
    for (const fail of signals.assetFailures) {
      const bits = [fail.url];
      if (fail.kind) bits.push(`kind=${fail.kind}`);
      if (fail.resourceType) bits.push(`type=${fail.resourceType}`);
      if (fail.error) bits.push(fail.error);
      lines.push(`- ${bits.join(' ')}`);
    }
  } else {
    lines.push('资源失败：（无）');
  }

  if (signals.consoleEntries.length > 0) {
    lines.push('控制台 warning/error：');
    for (const entry of signals.consoleEntries) {
      const where = entry.sourceId
        ? `${entry.sourceId}${typeof entry.line === 'number' ? `:${entry.line}` : ''}`
        : '（无来源）';
      lines.push(`- [${consoleLevelLabel(entry.level)}] ${where} ${entry.message}`);
    }
  } else {
    lines.push('控制台 warning/error：（无）');
  }

  return lines.join('\n');
}
