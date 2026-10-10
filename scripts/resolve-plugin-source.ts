const repository = normalizeRepository(process.env.RAW_REPOSITORY ?? '');
const tag = process.env.RAW_TAG ?? '';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('插件仓库须是 owner/name');
}
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
  throw new Error('tag 必须是 vX.Y.Z');
}
const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error('缺少 GITHUB_OUTPUT');
await import('node:fs').then((fs) => {
  fs.appendFileSync(output, `repository=${repository}\ntag=${tag}\n`);
});

function normalizeRepository(raw: string): string {
  let value = raw.trim();
  value = value.replace(/\.git$/, '');
  value = value.replace(/^https:\/\/github\.com\//, '');
  value = value.replace(/^http:\/\/github\.com\//, '');
  value = value.replace(/^git@github\.com:/, '');
  return value.replace(/^\/+|\/+$/g, '');
}
