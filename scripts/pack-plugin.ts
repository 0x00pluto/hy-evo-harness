import path from 'node:path';
import { packPluginRelease } from '../src/main/plugin-pack.ts';

const args = readArgs(process.argv.slice(2));
const sourceDir = required(args, 'dir');
const tag = required(args, 'tag');
const outDir = required(args, 'out-dir');

const packed = await packPluginRelease({
  sourceDir: path.resolve(sourceDir),
  tag,
  outDir: path.resolve(outDir),
});
process.stdout.write(`${packed.zipPath}\n${packed.jsonPath}\n`);

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
