# Document index

## Index

- `README.md`: Huyuan Hub 产品说明：Electron 宿主、插件契约、开发挂载与打包
- `docs/DESIGN.md`: 工作台壳视觉事实源：白底、浅灰选中、细线文字按钮；改 src/renderer 外观前先读
- `docs/build-and-release.md`: 桌面安装包、三端 CI、GitHub Release 页与应用内自动更新
- `docs/hub-plugin-architecture.md`: 插件化 Hub 技术选型与方案原文备份：注册表、app-plugin 协议、开发挂载、ZIP 安装；在线市场不在当前版本
- `AGENTS.md`: 本仓工作约定、目录语义与能力声明；代码检索先走 Codebase MCP；scaffold_version 2.4.0
- `docs/builtin-workflows/post-task-reflect.md`: 任务后反思（白痴指数 → 删 → 程序化 → 鲁棒 → 加速）；用户明确要求时触发，不自动跑
- `docs/builtin-workflows/extract-experience.md`: 提取经验 → 项目无关最佳实践；用户明确要求时触发；落盘须问或读 experience_target，默认本仓 docs/best-practices/
- `docs/builtin-workflows/consolidate-memory.md`: 记忆巩固与遗忘（冲突消解 → 情景提纯 → 剪枝）；仅用户显式触发；与反思 / 提取经验互不串联
- `docs/builtin-workflows/cut-release-tag.md`: 日常发版唯一入口；汇总变更 → upgrades → 对齐 package.json version → tag → 推送；Release 页由 Actions 创建，不要本地 gh release create；major 须人指定
- `docs/workflows/_TEMPLATE.md`: 业务 workflow 六段骨架；新建业务工作流时复制并改名，写完后删掉本行或改成真实条目
- `specs/prds/prd-wiki-index.md`: PRD 索引；正文为 `specs/prds/prd-{五位序号}-{feature-slug}.md`，本索引不计入序号
- `.cursor/commands/team/`: 团队命令（产品经理、工程验收官、前端工程师、测试工程师、自主交付工程师）；母版在 Obsidian，不在此复制全文
