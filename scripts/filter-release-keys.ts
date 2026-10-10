import fs from 'node:fs';
import { releaseKeysFromList } from '../src/main/plugin-catalog.ts';

const listPath = process.argv[2];
if (!listPath) {
  throw new Error('用法: filter-release-keys.ts <listbucket 输出文件>');
}
const text = fs.existsSync(listPath) ? fs.readFileSync(listPath, 'utf8') : '';
for (const key of releaseKeysFromList(text)) {
  process.stdout.write(`${key}\n`);
}
