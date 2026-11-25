import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONSOLE_LEVEL_ERROR,
  CONSOLE_LEVEL_WARNING,
  STATUS_CONSOLE,
  STATUS_SUBRESOURCE,
  diagnoseStatus,
  diagnosticFingerprint,
  formatBootLayoutSize,
  formatDiagnosticText,
  hasBootLayoutReport,
  isConsoleDiagnosable,
  pushAssetFailure,
  pushConsoleRing,
} from '../src/renderer/plugin-diagnostics.js';

test('只把 warning/error 记进控制台环', () => {
  assert.equal(isConsoleDiagnosable(1), false);
  assert.equal(isConsoleDiagnosable(CONSOLE_LEVEL_WARNING), true);
  assert.equal(isConsoleDiagnosable(CONSOLE_LEVEL_ERROR), true);

  const empty = pushConsoleRing([], { level: 1, message: 'info' });
  assert.deepEqual(empty, []);

  const one = pushConsoleRing([], {
    level: CONSOLE_LEVEL_ERROR,
    message: 'boom',
    sourceId: 'app-plugin://p/a.js',
    line: 3,
  });
  assert.equal(one.length, 1);
  assert.equal(one[0]?.message, 'boom');
});

test('忽略 Electron CSP Security Warning，不误报插件页面报错', () => {
  const csp = {
    level: CONSOLE_LEVEL_WARNING,
    message: 'Electron Security Warning (Insecure Content-Security-Policy) ...',
    sourceId: 'node:electron/js2c/sandbox_bundle',
  };
  assert.deepEqual(pushConsoleRing([], csp), []);
  assert.equal(
    diagnoseStatus({
      assetFailures: [],
      consoleEntries: pushConsoleRing([], csp),
    }),
    null,
  );

  const afterCsp = pushConsoleRing([], csp);
  const mixed = pushConsoleRing(afterCsp, {
    level: CONSOLE_LEVEL_ERROR,
    message: 'Uncaught ReferenceError: previewMode is not defined',
    sourceId: 'https://cdn.jsdelivr.net/npm/alpinejs@3.14.8/dist/cdn.min.js',
    line: 5,
  });
  assert.equal(mixed.length, 1);
  assert.deepEqual(
    diagnoseStatus({ assetFailures: [], consoleEntries: mixed }),
    { kind: 'console', message: STATUS_CONSOLE },
  );
});

test('资源失败优先于控制台；正常无状态', () => {
  assert.equal(diagnoseStatus({
    assetFailures: [],
    consoleEntries: [],
  }), null);

  assert.deepEqual(
    diagnoseStatus({
      assetFailures: [{ url: 'app-plugin://p/a.js', kind: 'protocol-404' }],
      consoleEntries: [{ level: CONSOLE_LEVEL_ERROR, message: 'x' }],
    }),
    { kind: 'asset', message: STATUS_SUBRESOURCE },
  );

  assert.deepEqual(
    diagnoseStatus({
      assetFailures: [],
      consoleEntries: [{ level: CONSOLE_LEVEL_WARNING, message: 'w' }],
    }),
    { kind: 'console', message: STATUS_CONSOLE },
  );

  assert.deepEqual(
    diagnoseStatus({
      openFailure: '插件页面样式未加载',
      assetFailures: [{ url: 'app-plugin://p/a.js' }],
      consoleEntries: [],
    }),
    { kind: 'openFailure', message: '插件页面样式未加载' },
  );
});

test('diagnosticFingerprint 对同信号稳定，内容变化则不同', () => {
  const base = {
    openFailure: null,
    guestGone: null,
    assetFailures: [{ url: 'app-plugin://p/a.js' }],
    consoleEntries: [{ level: CONSOLE_LEVEL_ERROR, message: 'boom', sourceId: 'a.js', line: 1 }],
  };
  const again = diagnosticFingerprint({
    ...base,
    assetFailures: [{ url: 'app-plugin://p/a.js' }],
    consoleEntries: [{ level: CONSOLE_LEVEL_ERROR, message: 'boom', sourceId: 'a.js', line: 1 }],
  });
  assert.equal(diagnosticFingerprint(base), again);

  const moreAssets = diagnosticFingerprint({
    ...base,
    assetFailures: [
      { url: 'app-plugin://p/b.js' },
      { url: 'app-plugin://p/a.js' },
    ],
  });
  assert.notEqual(diagnosticFingerprint(base), moreAssets);

  const moreConsole = diagnosticFingerprint({
    ...base,
    consoleEntries: [
      ...base.consoleEntries,
      { level: CONSOLE_LEVEL_WARNING, message: 'w', sourceId: 'a.js', line: 2 },
    ],
  });
  assert.notEqual(diagnosticFingerprint(base), moreConsole);
});

test('同 URL 资源失败去重；复制文本含约定字段不含密钥样例', () => {
  const failures = pushAssetFailure(
    [{ url: 'app-plugin://p/a.js', kind: 'protocol-404' }],
    { url: 'app-plugin://p/a.js', kind: 'web-request', resourceType: 'script', error: 'net::ERR' },
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.kind, 'web-request');

  const text = formatDiagnosticText(
    {
      hostVersion: '0.20.1',
      system: 'Win32',
      pluginId: 'xhs-growth',
      pluginVersion: '0.16.0',
      pluginSource: 'installed',
    },
    {
      assetFailures: failures,
      consoleEntries: [{
        level: CONSOLE_LEVEL_ERROR,
        message: 'ReferenceError: x',
        sourceId: 'app-plugin://xhs-growth/app.js',
        line: 10,
      }],
    },
  );

  assert.match(text, /宿主版本：0\.20\.1/);
  assert.match(text, /插件：xhs-growth/);
  assert.match(text, /插件版本：0\.16\.0/);
  assert.match(text, /app-plugin:\/\/p\/a\.js/);
  assert.match(text, /ReferenceError: x/);
  assert.match(text, /只清 HTTP 缓存/);
  assert.match(text, /启动布局（遮罩收起前）：（未知）/);
  assert.match(text, /启动布局（遮罩收起后）：（未知）/);
  assert.doesNotMatch(text, /api[_-]?key|secret|token|password/i);
});

test('formatBootLayoutSize 与 hasBootLayoutReport', () => {
  assert.equal(formatBootLayoutSize(0, 0), '0x0');
  assert.equal(formatBootLayoutSize(120.4, 80.6), '120x81');
  assert.equal(formatBootLayoutSize(Number.NaN, 10), '（未知）');
  assert.equal(hasBootLayoutReport({ assetFailures: [], consoleEntries: [] }), false);
  assert.equal(
    hasBootLayoutReport({
      assetFailures: [],
      consoleEntries: [],
      bootLayoutDuring: '0x0',
      bootLayoutAfter: '800x600',
    }),
    true,
  );
});

test('零诊断时复制文本仍含启动布局字段', () => {
  const text = formatDiagnosticText(
    {
      hostVersion: '0.21.0',
      system: 'MacIntel',
      pluginId: 'demo',
      pluginVersion: '1.0.0',
      pluginSource: 'installed',
    },
    {
      assetFailures: [],
      consoleEntries: [],
      bootLayoutDuring: '0x0',
      bootLayoutAfter: '960x640',
    },
  );
  assert.match(text, /状态：（无）/);
  assert.match(text, /启动布局（遮罩收起前）：0x0/);
  assert.match(text, /启动布局（遮罩收起后）：960x640/);
  assert.equal(
    diagnoseStatus({
      assetFailures: [],
      consoleEntries: [],
      bootLayoutDuring: '0x0',
      bootLayoutAfter: '960x640',
    }),
    null,
  );
});
