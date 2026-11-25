# 插件打开后 Lottie 消失了，工作区却是白的，宿主也没有红字？

## 现象

点开带界面的插件（例如小红书增长引擎），冷启动 Lottie 转一两秒后消失，工作区仍是一片白。侧栏选中正常，标题栏有重新加载。欢迎页没有回来，`#status` 也没有「打开插件失败」，粉红「插件报错」条也可能没有。

这和「第一次打开完全没样式」（见 `docs/faqs/first-open-plugin-unstyled.md`）以及「更新后挤在左侧」（见 `docs/faqs/plugin-update-stale-ui.md`）不同：那两类要么门闩拦住，要么版式错乱；这里是宿主已经当成打开成功。

## 原因

遮罩只在主帧 `did-finish-load` 且样式门闩通过之后收起。Lottie 能播完再消失，说明主文档和样式已经过关，访客 webview 已经露出来。

以前宿主只在两类失败时写红字并回欢迎页：主帧 `did-fail-load`，或样式门闩重试仍失败。脚本/样式文件 404、页面自己的 `console` 报错，都不会走这两条。Electron 也不会用 `did-fail-load` 报告子资源失败（维护者说明见 Electron #41766）。所以白屏时界面上可以「没有任何错误」。

旧版冷启动曾把 `is-booting` 的 webview 收成 0×0，遮罩收起后再放大；macOS 上 guest 有时不补画，也会出现转圈后全白且零报错。现已改为 booting 时保持真实尺寸，由 Lottie 遮罩盖住（见 `specs/prds/prd-00023-plugin-boot-blank-repaint.md`）。若仍白，可能还有会话 / 插件首屏逻辑等问题，不要只靠猜。

0.20.1 起更新会清插件分区的 HTTP 缓存，发生在重新挂上页面之前，不会把正在看的旧文档刷成白页。它也不清插件页面的 localStorage。

## 现在怎么收集信息

1. **有失败信号时**（见 `specs/prds/prd-00022-plugin-page-diagnostics.md`）：协议 404、分区 `webRequest`（script/stylesheet）、webview `console-message` warning/error（不算开发态 Electron CSP Security Warning）→ 粉红「插件报错」条，「一键复制错误信息」。
2. **零诊断仍白时**：打开插件详情，点「⋯」→「复制启动信息」（带 info 图标）。复制文本含宿主版本、插件 id/版本，以及**启动布局（遮罩收起前 / 后）**宿主侧盒模型（例如曾是 `0x0` → `960x640`）。不要靠「页面 DOM 是不是空的」去猜。

关掉粉红条后同一次报错不再占工作区；悬停卡 / 详情仍可复制。新错误或重新加载后再下浮粉红条。

## 相关

- 需求：`specs/prds/prd-00022-plugin-page-diagnostics.md`（飞书 `20261120_0027`）、`specs/prds/prd-00023-plugin-boot-blank-repaint.md`（飞书 `20261125_0029`）
- 对照：`docs/faqs/first-open-plugin-unstyled.md`、`docs/faqs/plugin-update-stale-ui.md`
