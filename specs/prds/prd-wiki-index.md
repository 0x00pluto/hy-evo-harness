# PRD 索引

产品经理写入新 PRD 后在此追加一行。文件名：`prd-{五位序号}-{feature-slug}.md`。本文件不计入序号。

## Index

- `specs/prds/prd-00001-plugin-settings.md`：00001，插件在设置页用 configSchema 声明配置，写入用户数据目录，并注入子进程环境变量。界面参考图在 `specs/prds/images/prd-00001-plugin-settings/`（`01-sidebar-settings-entry.png` 侧栏齿轮入口，`02-settings-page.png` 左导航右卡片）。工程 accepted
- `specs/prds/prd-00002-workbench-chrome.md`：00002，工作台壳改为图标轨与宽侧栏互斥，标题栏提供后退、前进和收起，设置页改为可拖分栏，图标用 Lucide。界面参考图在 `specs/prds/images/prd-00002-workbench-chrome/`（`01` 标题栏，`02` 收起，`03` 图标轨与弹出层，`04`–`05` 设置分栏）。工程 partial
- `specs/prds/prd-00003-plugins-page.md`：00003，图标轨拼图打开插件页（已安装列表、拖放安装台、详情与卸载），工作区去掉插件顶栏并由标题栏正中显示插件名，manifest 增加可选目录信息。界面参考图在 `specs/prds/images/prd-00003-plugins-page/`（`01` 图标轨加号，`02` 插件页，`03` 详情，`04` 卸载菜单，`05` 标题栏名称）。工程 accepted
- `specs/prds/prd-00004-plugin-market.md`：00004，左栏增加插件市场，右栏改为分类卡片货架，压缩包收进加号，目录补上图标和分类。界面参考图在 `specs/prds/images/prd-00004-plugin-market/`（`01` 货架，`02` 安装中与 toast，`03` 卡片菜单，`04` 路径提示）。工程 backlog
