import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NODE_VERSION,
  PYTHON_VERSION,
  RUNTIME_ARCHES,
  UV_VERSION,
  runtimeDownloadUrl,
  runtimeQiniuKey,
  type RuntimeArch,
} from '../src/main/plugin-runtime.ts';
import {
  decideUpload,
  nodeUpstreamName,
  parseQetag,
  parseQshellStat,
  pickPythonAsset,
  uvAssetName,
  uvDownloadCandidates,
} from '../src/main/publish-runtimes.ts';

const UV_ASSET: Record<RuntimeArch, string> = {
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
  'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
  'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
};

test('上游资源名和七牛键跟客户端下载路径一致', () => {
  for (const arch of RUNTIME_ARCHES) {
    assert.equal(uvAssetName(arch), UV_ASSET[arch]);
    assert.equal(
      uvDownloadCandidates(arch)[0],
      `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${UV_ASSET[arch]}`,
    );
    const nodeName = arch === 'win32-x64'
      ? `node-v${NODE_VERSION}-win-x64.zip`
      : `node-v${NODE_VERSION}-${arch}.tar.gz`;
    assert.equal(nodeUpstreamName(arch), nodeName);

    for (const kind of ['uv', 'python', 'node'] as const) {
      const key = runtimeQiniuKey(kind, arch);
      assert.equal(runtimeDownloadUrl(kind, arch), `https://oss.ai.66plat.com/${key}`);
    }
    assert.equal(
      runtimeQiniuKey('uv', arch),
      `dex-buddy/runtimes/uv/${UV_VERSION}/uv-${arch}${arch === 'win32-x64' ? '.exe' : ''}`,
    );
    assert.equal(
      runtimeQiniuKey('python', arch),
      `dex-buddy/runtimes/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-${arch}.tar.gz`,
    );
    assert.equal(
      runtimeQiniuKey('node', arch),
      `dex-buddy/runtimes/node/${NODE_VERSION}/node-v${NODE_VERSION}-${arch}.tar.gz`,
    );
  }
});

test('Python 取最新的 install_only，忽略 stripped 和其他架构', () => {
  const names = [
    `cpython-${PYTHON_VERSION}+20250101-aarch64-apple-darwin-install_only.tar.gz`,
    `cpython-${PYTHON_VERSION}+20251014-aarch64-apple-darwin-install_only.tar.gz`,
    `cpython-${PYTHON_VERSION}+20251014-aarch64-apple-darwin-install_only_stripped.tar.gz`,
    'cpython-9.9.9+20251014-aarch64-apple-darwin-install_only.tar.gz',
    `cpython-${PYTHON_VERSION}+20251014-x86_64-apple-darwin-install_only.tar.gz`,
  ];
  assert.equal(
    pickPythonAsset(names, 'darwin-arm64'),
    `cpython-${PYTHON_VERSION}+20251014-aarch64-apple-darwin-install_only.tar.gz`,
  );
  assert.equal(pickPythonAsset(names, 'win32-x64'), null);
});

test('远端没有就上传，hash 相同就跳过，不同才覆盖', () => {
  assert.deepEqual(decideUpload({ status: 'missing' }, 'local'), { action: 'upload', fallback: false });
  assert.deepEqual(
    decideUpload({ status: 'present', hash: 'same' }, 'same'),
    { action: 'skip', fallback: false },
  );
  assert.deepEqual(
    decideUpload({ status: 'present', hash: 'remote' }, 'local'),
    { action: 'overwrite', fallback: false },
  );
  assert.deepEqual(
    decideUpload({ status: 'unknown', detail: 'timeout' }, 'local'),
    { action: 'overwrite', fallback: true },
  );
  assert.deepEqual(
    decideUpload({ status: 'present', hash: 'remote' }, null),
    { action: 'overwrite', fallback: true },
  );
});

test('qshell stat 能分出不存在、已有和比较失败', () => {
  assert.deepEqual(
    parseQshellStat(1, '', 'stat error: no such file or directory (612)'),
    { status: 'missing' },
  );
  const sample = [
    'Bucket:                  demo',
    'Key:                     dex-buddy/runtimes/uv/0.9.2/uv-darwin-arm64',
    'Etag:                    lozgLP_MAdAKZkPCXGvfd0LIDSUI',
    'Fsize:                   12 -> 12B',
  ].join('\n');
  assert.deepEqual(parseQshellStat(0, sample, ''), {
    status: 'present',
    hash: 'lozgLP_MAdAKZkPCXGvfd0LIDSUI',
  });
  assert.deepEqual(parseQshellStat(0, 'Hash:\tFhabc\n', ''), { status: 'present', hash: 'Fhabc' });
  assert.equal(parseQshellStat(1, '', 'connection reset').status, 'unknown');
  assert.equal(parseQetag(0, 'Fhlocal\tfile\n'), 'Fhlocal');
  assert.equal(parseQetag(1, ''), null);
});
