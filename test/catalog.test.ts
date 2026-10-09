import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isHttpUrl, parseManifest, readManifestFile } from '../src/main/manifest.ts';

function baseManifest(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'demo',
    displayName: '示例',
    version: '1.0.0',
    type: 'headless',
    main: 'index.js',
    ...extra,
  };
}

const catalog = {
  description: '把稿件做成一集漫剧',
  icon: 'icon.png',
  developer: '互远',
  category: '创作',
  website: 'https://example.com',
  privacyPolicy: 'https://example.com/privacy',
  termsOfService: 'https://example.com/terms',
};

test('目录字段缺省时插件仍可加载，也不算错误', () => {
  const manifest = parseManifest(baseManifest());
  assert.equal(manifest.id, 'demo');
  assert.equal(manifest.description, undefined);
  assert.equal(manifest.icon, undefined);
  assert.equal(manifest.developer, undefined);
  assert.equal(manifest.category, undefined);
  assert.equal(manifest.website, undefined);
  assert.equal(manifest.privacyPolicy, undefined);
  assert.equal(manifest.termsOfService, undefined);
  assert.equal(manifest.catalogError, undefined);
});

test('目录字段的空字符串当作没写', () => {
  const manifest = parseManifest(baseManifest({
    description: '  ',
    icon: '',
    developer: '',
    category: ' ',
    website: '',
    privacyPolicy: '   ',
    termsOfService: '',
  }));
  assert.equal(manifest.description, undefined);
  assert.equal(manifest.icon, undefined);
  assert.equal(manifest.website, undefined);
  assert.equal(manifest.catalogError, undefined);
});

test('合法目录信息会保留下来', () => {
  const manifest = parseManifest(baseManifest(catalog));
  assert.equal(manifest.description, catalog.description);
  assert.equal(manifest.icon, 'icon.png');
  assert.equal(manifest.developer, '互远');
  assert.equal(manifest.category, '创作');
  assert.equal(manifest.website, catalog.website);
  assert.equal(manifest.privacyPolicy, catalog.privacyPolicy);
  assert.equal(manifest.termsOfService, catalog.termsOfService);
  assert.equal(manifest.catalogError, undefined);
});

test('非法 URL 和越界图标不阻止加载，并写入 catalogError', () => {
  const manifest = parseManifest(baseManifest({
    description: '仍然显示',
    icon: '../secret.png',
    website: 'javascript:alert(1)',
    privacyPolicy: 'not a url',
  }));
  assert.equal(manifest.id, 'demo');
  assert.equal(manifest.description, '仍然显示');
  assert.equal(manifest.icon, undefined);
  assert.equal(manifest.website, undefined);
  assert.equal(manifest.privacyPolicy, undefined);
  assert.match(manifest.catalogError || '', /icon 必须是插件目录内/);
  assert.match(manifest.catalogError || '', /website 须为不超过 300 字符的 http\(s\) 链接/);
  assert.match(manifest.catalogError || '', /privacyPolicy 须为不超过 300 字符的 http\(s\) 链接/);
});

test('类型不是字符串的目录字段算错误', () => {
  const manifest = parseManifest(baseManifest({ developer: 12, category: false }));
  assert.equal(manifest.developer, undefined);
  assert.equal(manifest.category, undefined);
  assert.match(manifest.catalogError || '', /developer 必须是字符串/);
  assert.match(manifest.catalogError || '', /category 必须是字符串/);
});

test('图标路径合法但文件不存在时去掉图标并记录错误', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-buddy-catalog-'));
  try {
    fs.writeFileSync(path.join(dir, 'plugin.manifest.json'), JSON.stringify(baseManifest({
      icon: 'icon.png',
      developer: '互远',
    })));
    const manifest = readManifestFile(dir);
    assert.equal(manifest.icon, undefined);
    assert.equal(manifest.developer, '互远');
    assert.equal(manifest.catalogError, 'icon 文件不存在');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isHttpUrl 只接受带主机名的 http(s)', () => {
  assert.equal(isHttpUrl('https://example.com/privacy'), true);
  assert.equal(isHttpUrl('http://localhost'), true);
  assert.equal(isHttpUrl('file:///etc/passwd'), false);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('https://'), false);
  assert.equal(isHttpUrl('not a url'), false);
});
