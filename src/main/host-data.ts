import path from 'node:path';

/** 与安装目录同名。渲染进程只提交种类，不提交路径。 */
export const INSTALLED_PLUGINS_DIR_NAME = 'installed_plugins';

/**
 * 只解析通用设置允许打开的两个目录。
 * 其它值返回 null，调用方不得据此创建目录。
 */
export function resolveHostDataPath(kind: unknown, userData: string): string | null {
  if (typeof userData !== 'string' || userData.trim() === '') return null;
  const root = path.resolve(userData);
  if (kind === 'userData') return root;
  if (kind === 'installedPlugins') return path.join(root, INSTALLED_PLUGINS_DIR_NAME);
  return null;
}
