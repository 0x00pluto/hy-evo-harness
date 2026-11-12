# 首次打开插件页面没有样式？

## 现象

Windows 装好客户端后，第一次点开界面插件（例如小红书增长引擎），工作区像浏览器默认表单；强制退出再开，或卸了插件再装，又正常。

## 原因

两处叠加：

1. 市场包不带 `node_modules`。宿主装好依赖后，在插件目录里联到 `userData/plugin-runtime/<id>/env/node_modules`。旧版 `app-plugin://` 用 `realpath` 发现文件在插件目录外就 404，CSS/JS 加载失败，页面变裸 HTML。
2. 冷启动遮罩在主文档 `did-finish-load` 就撤。HTML 到了、样式还没到（或 404）时，也会把半成品当成「已打开」。

## 宿主怎么修的

- 协议：词法路径仍须在插件目录内；真实文件若落在该插件宿主自管的 `plugin-runtime/<id>/env` 根下则放行。指到任意其它地方的联接仍拒绝。
- 打开门闩：有 `link[rel=stylesheet]` 时须都能读到 `sheet` 才撤遮罩；失败自动重载一次，再失败则回到欢迎页并提示，不留裸成功页。

## 相关

- 需求：`specs/prds/prd-00018-first-open-plugin-ready.md`（飞书 `20261106_0006`）
- 运行说明：`docs/plugin-development/runtime.md`
