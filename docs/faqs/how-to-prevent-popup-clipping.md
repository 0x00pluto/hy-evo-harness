### **Q: 如何避免工作台弹出层被外层容器裁掉？**

**A:**
插件市场已安装卡片的「…」菜单节点是齐的，屏幕上却只剩按钮底下一条浅框。弹出层不要用绝对定位挂在 `overflow` 容器里；用 `position: fixed`，打开时按按钮的位置摆放。

**问题症状：**
- 菜单里已有「立即使用」「详情」「卸载」，不是空节点
- 点「…」后只看见按钮底下一条浅框，其余菜单被裁掉
- 控制台没有报错

**根本原因：**
菜单曾用 `position: absolute` 挂在卡片里的 `.plugin-more-wrap` 上。`#plugins-market-list` 只有 `overflow: auto` 和 `min-height: 0`，没有 `flex: 1`。它的父级是纵向 flex，所以列表高度等于卡片内容。绝对定位的菜单不撑高父级，一越出列表就被裁掉。越出去的部分又画不出 `#plugins-screen` 和 `#main-container` 的 `overflow: hidden`。按钮在卡片里垂直居中，菜单从按钮下沿再往下 4px，所以只剩和卡片重叠的那一条。

**解决方案：**
和文件夹提示 `.plugin-folder-tip` 一样处理。`.plugin-menu` 用 `position: fixed`。打开时用 `placeMenu`（`src/renderer/plugins-page.js`）按「更多」按钮的 `getBoundingClientRect()` 摆放：默认在按钮下沿 4px、右缘对齐；底部放不下就翻到按钮上方；左右留在视口内。货架列表、详情页滚动，以及窗口尺寸变化时关掉菜单。`z-index` 为 20，低于 toast 的 30。

不要只给 `#plugins-market-list` 加 `flex: 1`。列表撑满只能保住靠上的卡片，滚到滚动区底边的菜单仍会被 `overflow: auto` 裁掉。

这些祖先目前没有 `transform`、`filter` 或 `contain: paint`。一旦加上，固定定位会改以那个祖先为参照，`overflow` 又会把弹出层裁掉。

**错误配置示例：**
```css
.plugin-more-wrap { position: relative; }

.plugin-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
}
```

**正确配置示例：**
```css
.plugin-menu {
  position: fixed;
  z-index: 20;
}
```

```javascript
// placeMenu：先取消 hidden 再量尺寸，否则高度是 0
const anchor = button.getBoundingClientRect();
const box = menu.getBoundingClientRect();
let top = anchor.bottom + 4;
if (top + box.height > window.innerHeight - 8) top = anchor.top - 4 - box.height;
let left = anchor.right - box.width;
```

**关键配置要点：**
- 必须伸出卡片的菜单、提示，不要 `position: absolute` 在 `overflow: auto` 或 `overflow: hidden` 的后代里
- `position: fixed` 配合按钮的 `getBoundingClientRect()`，不要写死 `top` / `right`
- 滚动和窗口尺寸变化时关掉或重新摆放，避免固定层和按钮错位
- 祖先不要加 `transform`、`filter`、`contain: paint`，否则固定定位仍会被裁切
