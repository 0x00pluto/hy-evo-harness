import fs from 'node:fs';
import type { Logger } from './types.ts';

export function readExtraPluginPaths(configPath: string, logger: Logger): string[] {
  if (!fs.existsSync(configPath)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
  } catch (err) {
    logger.error(`读取开发配置失败: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { extraPluginPaths?: unknown }).extraPluginPaths)) {
    logger.error(`开发配置缺少 extraPluginPaths 数组: ${configPath}`);
    return [];
  }

  const paths = (parsed as { extraPluginPaths: unknown[] }).extraPluginPaths;
  const result: string[] = [];
  for (const item of paths) {
    if (typeof item !== 'string' || item.trim() === '') {
      logger.error('extraPluginPaths 中存在无效路径，已跳过');
      continue;
    }
    result.push(item);
  }
  return result;
}

export function readForceUpdateIcon(configPath: string, logger: Logger): boolean {
  if (!fs.existsSync(configPath)) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
  } catch (err) {
    logger.error(`读取开发配置失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  if (!parsed || typeof parsed !== 'object') return false;
  return (parsed as { forceUpdateIcon?: unknown }).forceUpdateIcon === true;
}

/** 未打包时可读；无效或缺失时返回 null，由 resolveGatewayBaseUrl 落默认值。 */
export function readGatewayBaseUrl(configPath: string, logger: Logger): string | null {
  if (!fs.existsSync(configPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
  } catch (err) {
    logger.error(`读取开发配置失败: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const value = (parsed as { gatewayBaseUrl?: unknown }).gatewayBaseUrl;
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}
