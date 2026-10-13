# PRD 索引

产品经理写入新 PRD 后在此追加一行。文件名：`prd-{五位序号}-{feature-slug}.md`。本文件不计入序号。

## Index

- `specs/prds/prd-00001-plugin-settings.md`：00001，插件在设置页用 configSchema 声明配置，写入用户数据目录，并注入子进程环境变量。界面参考图在 `specs/prds/images/prd-00001-plugin-settings/`（`01-sidebar-settings-entry.png` 侧栏齿轮入口，`02-settings-page.png` 左导航右卡片）。工程 accepted
- `specs/prds/prd-00002-workbench-chrome.md`：00002，工作台壳改为图标轨与宽侧栏互斥，标题栏提供后退、前进和收起，设置页改为可拖分栏，图标用 Lucide。界面参考图在 `specs/prds/images/prd-00002-workbench-chrome/`（`01` 标题栏，`02` 收起，`03` 图标轨与弹出层，`04`–`05` 设置分栏）。工程 partial
- `specs/prds/prd-00003-plugins-page.md`：00003，图标轨拼图打开插件页（已安装列表、拖放安装台、详情与卸载），工作区去掉插件顶栏并由标题栏正中显示插件名，manifest 增加可选目录信息。界面参考图在 `specs/prds/images/prd-00003-plugins-page/`（`01` 图标轨加号，`02` 插件页，`03` 详情，`04` 卸载菜单，`05` 标题栏名称）。工程 accepted
- `specs/prds/prd-00004-plugin-market.md`：00004，左栏增加插件市场，右栏改为分类卡片货架，压缩包收进加号，目录补上图标和分类。界面参考图在 `specs/prds/images/prd-00004-plugin-market/`（`01` 货架，`02` 安装中与 toast，`03` 卡片菜单，`04` 路径提示）。工程 backlog
- `specs/prds/prd-00005-system-settings.md`：00005，设置页左栏在插件列表之上增加「个人设置 / 通用设置」，右侧只读展示产品名、版本和本机用户，并可检查更新、打开用户数据目录与已安装插件目录。工程 backlog
- `specs/prds/prd-00006-mac-dmg-quit-after-open.md`：00006，macOS 在 dmg 安装盘成功打开后立即退出进程，便于拖入「应用程序」覆盖；有进行中任务则不下载、不退出。工程 accepted
- `specs/prds/prd-00007-load-unpacked-plugin.md`：00007，已安装的 Dex Buddy 可从插件页加载本地插件目录；本地实例按目录路径生成独立 id，配置与数据与线上插件隔离；另可按插件中心规则做发布预览。工程 partial
- `specs/prds/prd-00008-unbundle-example-plugins.md`：00008，安装包不再带 `plugins/` 里的两份示例；只有未打包的 `pnpm start` 才加载，界面标为示例，并在升级时按条件清掉样品设置。工程 accepted
- `specs/prds/prd-00009-plugin-view-keepalive.md`：00009，侧栏互切以及从插件页或设置页回来时保持插件界面；隐藏页降频，硬上限 5 再按可用内存缩到 3 或 1，最久未用的隐藏页被拆掉。工程 accepted
- `specs/prds/prd-00010-plugin-silent-update.md`：00010，从插件市场安装的插件在启动时和每 6 小时静默更新；正在看的那个离开后再装。手动更新仍留在市场菜单。工程 accepted
