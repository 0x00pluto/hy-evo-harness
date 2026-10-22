/**
 * 壳内固定节点查询。节点在 index.html 里，缺了就是编程错误。
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {string} id
 * @param {K} _tag
 * @returns {HTMLElementTagNameMap[K]}
 */
export function byId(id, _tag) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 #${id}`);
  return /** @type {HTMLElementTagNameMap[K]} */ (el);
}
