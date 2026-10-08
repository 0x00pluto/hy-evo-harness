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
