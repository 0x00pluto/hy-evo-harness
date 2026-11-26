### **Q: 为什么进过插件页后，图标轨更新钮悬停提示就没了？**

**A:**
图标轨「有可用更新」气泡挂在 `document.body` 上且应常驻。插件页换详情或市场时若用过宽的 `.hover-tip` 选择器清理 tip，会把这颗常驻节点也 `remove()`；之后悬停仍触发监听，但改的是已脱离 DOM 的节点，屏幕上看不见。

**问题症状：**
- 刚启动时鼠标移到蓝色下载钮，右侧能出现「有可用更新」
- 进过插件市场或插件详情再回工作台后，再悬停不再出现气泡
- 控制台没有报错；蓝钮本身仍在、点击仍能打开更新对话框

**根本原因：**
共用悬停提示抽到 `src/renderer/ui/hover-tip.js` 后，插件页 `clearFolderTips` 调用 `clearHoverTips`。早期默认选择器含 `.hover-tip`，与目录 tip（`hover-tip plugin-folder-tip`）和轨上常驻 tip（仅 `hover-tip`，如 `#rail-update-tip`）都会匹配。`renderDetail` / `renderMarket` 一跑就摘掉常驻 tip；`#rail-update` 上的 `pointerenter` 仍绑定旧节点，`hidden = false` 不会画回页面。

这与「弹出层被 overflow 裁切」不是一类问题：节点其实已经不在文档树里。

**解决方案：**
清理可丢弃的目录 tip 时，选择器只用 `.plugin-folder-tip`。常驻 tip 不要加 `plugin-folder-tip`，也不要把 `.hover-tip` 写进 clear 默认选择器。用常量 `FOLDER_HOVER_TIP_CLEAR_SELECTOR` 钉死，并在单测里断言选择器不含 `.hover-tip`。

**错误配置示例：**
```javascript
// 过宽：会摘掉 #rail-update-tip
export function clearHoverTips(selector = '.hover-tip, .plugin-folder-tip') {
  document.querySelectorAll(selector).forEach((node) => node.remove());
}
```

**正确配置示例：**
```javascript
export const FOLDER_HOVER_TIP_CLEAR_SELECTOR = '.plugin-folder-tip';

export function clearHoverTips(selector = FOLDER_HOVER_TIP_CLEAR_SELECTOR) {
  document.querySelectorAll(selector).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.remove();
  });
}

// 目录 tip
createHoverTip({ className: 'hover-tip plugin-folder-tip', content: path });

// 轨上常驻 tip：只有 hover-tip，不要 plugin-folder-tip
createHoverTip({ id: 'rail-update-tip', className: 'hover-tip', content: '有可用更新' });
```

**关键配置要点：**
- `hideAllHoverTips` 只藏不删；`clearHoverTips` 才 `remove`，调用方必须收窄范围
- 常驻 tip 与「详情换页可重建」的 tip 要用不同 class（或 data 属性）区分
- 定位仍用 `position: fixed` 挂 `body`（见裁切 FAQ）；本篇只管生命周期，不谈裁切
- 回归：悬停成功 → 进插件页再回工作台 → 再悬停仍应出现

**参考文档：**
- [`src/renderer/ui/hover-tip.js`](../../src/renderer/ui/hover-tip.js)
- [`specs/prds/prd-00024-rail-update-tooltip.md`](../../specs/prds/prd-00024-rail-update-tooltip.md)
- [`docs/faqs/how-to-prevent-popup-clipping.md`](./how-to-prevent-popup-clipping.md)
