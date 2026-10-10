# Document index

## Index

- `README.md`: Dex Buddy 产品说明：Electron 宿主、插件契约、开发挂载与打包
- `docs/DESIGN.md`: 工作台壳视觉事实源：白底、浅灰选中、细线文字按钮、双色独角兽字标；图标轨拼图打开插件页，标题栏正中可显示插件名；启动遮罩居中独角兽；控件第二次出现再抽到 src/renderer/ui/；改 src/renderer 外观前先读
- `docs/build-and-release.md`: 桌面安装包、三端 CI、GitHub Release 页，以及从七牛下载的应用内自动更新
- `docs/hub-plugin-architecture.md`: Dex Buddy 插件化技术选型与方案原文备份：注册表、app-plugin 协议、开发挂载、ZIP 安装；第一期插件中心见 publish-plugin 工作流，不改技能中心
- `docs/plugin-development.md`: 插件开发说明已拆到 `docs/plugin-development/`，本文件只保留入口
- `docs/plugin-development/README.md`: 可单独转发的插件开发目录：交什么、两种插件，以及清单、设置、运行、发布、插件中心、配色的入口
- `docs/plugin-development/manifest.md`: plugin.manifest.json 字段与图标尺寸、画布、格式
- `docs/plugin-development/settings.md`: configSchema、分组、密钥输入与眼睛、settingsEntry、pluginEnv
- `docs/plugin-development/runtime.md`: index.js、页面里的 dex.call、带界面与无界面示例
- `docs/plugin-development/ship.md`: 开发挂载、zip 拖进工作台安装，以及会加载失败的情况
- `docs/plugin-development/distribute.md`: 插件作者发到插件中心：只推 tag；需要编译时用 dex-buddy-plugin-pack.json 声明脚本，三端二进制分别放进 bin/darwin、bin/win32、bin/linux
- `docs/plugin-development/color.md`: 插件页面配色建议：中性色可粘贴，也可自选颜色；壳不检查
- `AGENTS.md`: 本仓工作约定、目录语义与能力声明；代码检索先走 Codebase MCP；scaffold_version 2.4.0
- `docs/builtin-workflows/post-task-reflect.md`: 任务后反思（白痴指数 → 删 → 程序化 → 鲁棒 → 加速）；用户明确要求时触发，不自动跑
- `docs/builtin-workflows/extract-experience.md`: 提取经验 → 项目无关最佳实践；用户明确要求时触发；落盘须问或读 experience_target，默认本仓 docs/best-practices/
- `docs/builtin-workflows/consolidate-memory.md`: 记忆巩固与遗忘（冲突消解 → 情景提纯 → 剪枝）；仅用户显式触发；与反思 / 提取经验互不串联
- `docs/builtin-workflows/cut-release-tag.md`: 日常发版唯一入口；汇总变更 → upgrades → 对齐 package.json version → tag → 推送；Release 页由 Actions 创建，不要本地 gh release create；major 须人指定
- `docs/workflows/_TEMPLATE.md`: 业务 workflow 六段骨架；新建业务工作流时复制并改名，写完后删掉本行或改成真实条目
- `docs/workflows/publish-plugin.md`: 维护者在本仓手动触发：按插件声明先编译再打 zip，上传七牛并合成目录；作者步骤见 distribute.md
- `specs/prds/prd-wiki-index.md`: PRD 索引；正文为 `specs/prds/prd-{五位序号}-{feature-slug}.md`，本索引不计入序号
- `.cursor/commands/team/`: 团队命令（产品经理、工程验收官、前端工程师、测试工程师、自主交付工程师）；母版在 Obsidian，不在此复制全文
- `docs/renderer-layout.md`: 设置页和插件页共用一份 #split-layout；以后在第四个分栏表面把间距改散，或单页拼 DOM 超过约 800 行时，再引入 Lit 具名插槽，本次不安装
