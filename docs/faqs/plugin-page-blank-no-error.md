# 插件打开后 Lottie 消失了，工作区却是白的，宿主也没有红字？

## 现象

点开带界面的插件（例如小红书增长引擎），冷启动 Lottie 转一两秒后消失，工作区仍是一片白。侧栏选中正常，标题栏有重新加载。欢迎页没有回来，`#status` 也没有「打开插件失败」。

这和「第一次打开完全没样式」（见 `docs/faqs/first-open-plugin-unstyled.md`）以及「更新后挤在左侧」（见 `docs/faqs/plugin-update-stale-ui.md`）不同：那两类要么门闩拦住，要么版式错乱；这里是宿主已经当成打开成功。

## 原因

遮罩只在主帧 `did-finish-load` 且样式门闩通过之后收起。Lottie 能播完再消失，说明主文档和样式已经过关，访客 webview 已经露出来。

以前宿主只在两类失败时写红字并回欢迎页：主帧 `did-fail-load`，或样式门闩重试仍失败。脚本/样式文件 404、页面自己的 `console` 报错，都不会走这两条。Electron 也不会用 `did-fail-load` 报告子资源失败（维护者说明见 Electron #41766）。所以白屏时界面上可以「没有任何错误」。

0.20.1 起更新会清插件分区的 HTTP 缓存，发生在重新挂上页面之前，不会把正在看的旧文档刷成白页。它也不清插件页面的 localStorage。

## 现在怎么收集信息

宿主会把这些**现成信号**露出来（见 `specs/prds/prd-00022-plugin-page-diagnostics.md`）：

1. `app-plugin://` 协议回 404（主进程协议 handler 已知）
2. 同插件 persist 分区上 `session.webRequest.onErrorOccurred`（至少 script / stylesheet）
3. webview `console-message` 的 warning / error（**不算**开发态 Electron 自己的 CSP Security Warning；那条打包后本来就不会出现，单独出现时不应下浮「插件报错」条）

有信号时工作区顶部下浮粉红「插件报错」条，可「一键复制错误信息」把宿主版本、插件 id/版本和上述字段复制给支持。关掉后同一次报错不再占工作区；侧栏悬停卡片分割线下、或插件页详情「… / 立即使用」旁仍有红色「一键复制错误信息」（有诊断才出现）。新错误或重新加载后再下浮粉红条。不要靠「页面 DOM 是不是空的」去猜。

## 相关

- 需求：`specs/prds/prd-00022-plugin-page-diagnostics.md`（飞书 `20261120_0027`）
- 对照：`docs/faqs/first-open-plugin-unstyled.md`、`docs/faqs/plugin-update-stale-ui.md`
