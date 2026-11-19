# 插件更新后界面挤在左侧 / 没有样式？

## 现象

市场插件（例如小红书增长引擎）更新或覆盖安装之后，工作区文字和按钮挤在左侧，像浏览器默认表单。退出 Dex Buddy 再开仍如此。卸载该插件再安装，并点标题栏重新加载，又正常。

这和「第一次打开完全没样式」（见 `docs/faqs/first-open-plugin-unstyled.md`）不同：那次是首次安装时协议拒联接或门闩过早；这次是**更新之后**，磁盘上往往已经是新包。

## 原因

界面插件用持久分区 `persist:hyplugin-<插件 id>`。页面和 CSS/JS 都走 `app-plugin://`。覆盖安装会整份换掉 `installed_plugins/<id>/`，但：

1. 旧版协议响应没有 `Cache-Control`，分区 HTTP 缓存可能继续命中**旧文件内容**或安装窗口期留下的 **404**。
2. 退出再开仍用同一 persist 分区，所以新建 webview 也会坏。
3. 卸载会清运行环境并重装依赖；再加载时更容易重新拉到磁盘上的新文件。产品不能依赖「先卸再装」。

## 宿主怎么修的

- `app-plugin://` 成功与 404 响应都带 `Cache-Control: no-cache`，每次向磁盘校验。
- zip / 市场安装成功，以及卸载成功后，清理该插件分区的 HTTP 缓存，再允许冷开或下次打开。

## 相关

- 需求：`specs/prds/prd-00021-plugin-update-stale-ui.md`（飞书 `20261118_0024`）
- 对照：`docs/faqs/first-open-plugin-unstyled.md`、`specs/prds/prd-00018-first-open-plugin-ready.md`
