import fs from 'node:fs';
import path from 'node:path';
import { loadPluginPublish } from '../src/main/plugin-publish.ts';

const args = readArgs(process.argv.slice(2));
const sourceDir = path.resolve(required(args, 'dir'));
const publish = loadPluginPublish(sourceDir);
const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error('缺少 GITHUB_OUTPUT');

const lines = publish
  ? ['has_pack=true', `pack=${publish.pack}`]
  : ['has_pack=false', 'pack='];
fs.appendFileSync(output, `${lines.join('\n')}\n`);

function readArgs(argv: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`缺少参数 ${token}`);
    }
    result.set(key, value);
    index += 1;
  }
  return result;
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`缺少 --${key}`);
  return value;
}
