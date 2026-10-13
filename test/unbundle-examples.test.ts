import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exampleSettingIdsToDrop, PluginSettingsStore, type LoadedPluginRef } from '../src/main/plugin-settings.ts';
import type { Logger } from '../src/main/types.ts';

const silent: Logger = { info() {}, error() {} };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function filesBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'files:');
  assert.notEqual(start, -1);
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  return block.join('\n');
}

test('安装包文件列表不含示例插件目录', () => {
  const block = filesBlock(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
  assert.equal(block.includes('plugins/**'), false);
  assert.equal(block.includes('dist/**'), true);
  assert.equal(block.includes('src/renderer/**'), true);
  assert.equal(block.includes('src/preload/**'), true);
});

test('示例设置只在三条同时成立时删除', () => {
  const cases: Array<{
    name: string;
    loaded: LoadedPluginRef[];
    installedIds: string[];
    drop: string[];
  }> = [
    {
      name: '三条都成立',
      loaded: [],
      installedIds: [],
      drop: ['ai-comic-master', 'quanmedia-crawl'],
    },
    {
      name: 'bundled 留下对应 id',
      loaded: [{ source: 'bundled', manifestId: 'ai-comic-master' }],
      installedIds: [],
      drop: ['quanmedia-crawl'],
    },
    {
      name: '已安装目录留下对应 id',
      loaded: [],
      installedIds: ['quanmedia-crawl'],
      drop: ['ai-comic-master'],
    },
    {
      name: '本地实例留下对应 id',
      loaded: [{ source: 'local', manifestId: 'ai-comic-master' }],
      installedIds: [],
      drop: ['quanmedia-crawl'],
    },
    {
      name: '已加载的 installed 来源不算目录占用',
      loaded: [{ source: 'installed', manifestId: 'ai-comic-master' }],
      installedIds: [],
      drop: ['ai-comic-master', 'quanmedia-crawl'],
    },
    {
      name: '其它清单 id 和 dev- 实例 id 不挡',
      loaded: [
        { source: 'bundled', manifestId: 'other-tool' },
        { source: 'local', manifestId: 'dev-abcdef' },
      ],
      installedIds: ['other-tool', 'dev-abcdef'],
      drop: ['ai-comic-master', 'quanmedia-crawl'],
    },
  ];

  for (const item of cases) {
    assert.deepEqual(
      exampleSettingIdsToDrop({ loaded: item.loaded, installedIds: item.installedIds }).sort(),
      [...item.drop].sort(),
      item.name,
    );
  }
});

test('按返回的清单 id 删除设置时其它键保持原样', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-examples-'));
  try {
    const file = path.join(work, 'plugin-settings.json');
    const original = {
      'ai-comic-master': { TOKEN: 'sample' },
      'quanmedia-crawl': { FANS: 1 },
      'other-tool': { KEEP: 'yes' },
      'dev-abcdef': { LOCAL: 'stay' },
    };
    fs.writeFileSync(file, `${JSON.stringify(original, null, 2)}\n`);
    const store = new PluginSettingsStore(file, silent);
    const ids = exampleSettingIdsToDrop({
      loaded: [{ source: 'bundled', manifestId: 'ai-comic-master' }],
      installedIds: [],
    });
    for (const id of ids) store.deletePlugin(id);
    const after = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(after['ai-comic-master'], { TOKEN: 'sample' });
    assert.equal(Object.prototype.hasOwnProperty.call(after, 'quanmedia-crawl'), false);
    assert.deepEqual(after['other-tool'], { KEEP: 'yes' });
    assert.deepEqual(after['dev-abcdef'], { LOCAL: 'stay' });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
