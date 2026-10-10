import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_PUBLISH_FILE = 'dex-buddy-plugin-pack.json';

/** 插件改为在同事机器上安装依赖，发布时不再编译二进制。 */
export function assertNoBinaryPack(root: string): void {
  const file = path.join(root, PLUGIN_PUBLISH_FILE);
  if (!fs.existsSync(file)) return;
  throw new Error(`已不再编译二进制，请删除 ${PLUGIN_PUBLISH_FILE}`);
}
