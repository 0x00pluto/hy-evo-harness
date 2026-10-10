import fs from 'node:fs';
import path from 'node:path';
import { buildPluginCatalog, parsePluginRelease } from '../src/main/plugin-catalog.ts';
import type { PluginRelease } from '../src/main/plugin-catalog.ts';

const args = readArgs(process.argv.slice(2));
const dir = path.resolve(required(args, 'dir'));
const outPath = path.resolve(required(args, 'out'));
const releases: PluginRelease[] = [];
for (const filePath of walkJson(dir)) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    process.stderr.write(`跳过无法解析的版本说明: ${filePath}\n`);
    continue;
  }
  const release = parsePluginRelease(parsed);
  if (!release) {
    process.stderr.write(`跳过无效的版本说明: ${filePath}\n`);
    continue;
  }
  releases.push(release);
}
const catalog = buildPluginCatalog(releases, new Date().toISOString());
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
process.stdout.write(`${catalog.plugins.length}\n`);

function walkJson(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (name.endsWith('.json') && name !== 'index.json') files.push(full);
    }
  }
  files.sort();
  return files;
}

function readArgs(argv: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`缺少参数 ${token}`);
    result.set(token.slice(2), value);
    index += 1;
  }
  return result;
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`缺少 --${key}`);
  return value;
}
