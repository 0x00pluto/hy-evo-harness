# Huyuan Hub — Huyuan AI 统一工作台

Electron 宿主扫描插件、注册服务，并用 `app-plugin://` 打开插件界面。插件后端是普通 CommonJS，不需要自己监听端口。在线插件市场不在当前版本里。产品契约见 [README.md](./README.md)。

## 脚手架

| 字段 | 值 |
|---|---|
| scaffold_version | 2.4.0 |

## 开始工作前

1. 先读 [`docs/doc_index.md`](./docs/doc_index.md) 找到相关文档，再动手。
2. 改动落进既有目录语义（见下表），不新增平级顶层目录。
3. 新增或改动文档后，登记进 `docs/doc_index.md`。
4. **分夹**：新建可复跑的**业务**工作流 → 只写 [`docs/workflows/<slug>.md`](./docs/workflows/)（先复制 `_TEMPLATE.md`）。**禁止**在 [`docs/builtin-workflows/`](./docs/builtin-workflows/) 新建业务 slug。
5. **任务后反思**：用户明确要求反思 / 任务后回顾 / 跑 post-task-reflect 时（建议在用户已验证本轮产物可用之后）→ 读并执行 [`docs/builtin-workflows/post-task-reflect.md`](./docs/builtin-workflows/post-task-reflect.md)。**不**在每次任务结束后自动跑。
6. **跳过反思**：当前任务就是在跑本反思（禁止套娃）；用户明确说不要回顾。
7. **提取经验**：用户明确要求提取经验 / 提炼最佳实践 / 抽跨项目共性时 → 读并执行 [`docs/builtin-workflows/extract-experience.md`](./docs/builtin-workflows/extract-experience.md)。与反思同为手动触发、互不串联；**不**在每次任务后自动跑。落盘目录见该流（须问用户或读 AGENTS `experience_target`）。
8. **记忆巩固与遗忘**：用户明确要求遗忘 / 记忆巩固 / consolidate-memory / 剪枝记忆时 → 读并执行 [`docs/builtin-workflows/consolidate-memory.md`](./docs/builtin-workflows/consolidate-memory.md)。与反思、提取经验同为手动触发、互不串联；**不**自动跑。当前任务已是本流则禁止套娃。
9. **发工牌**：用户明确要求发工牌 / 写工牌 / 首次发布 / 改合同字段（`name`·`origin`·`depends_on`）时 → 读并执行 [`docs/builtin-workflows/publish-evo-agent-pack.md`](./docs/builtin-workflows/publish-evo-agent-pack.md)。**日常发版不要从本条进门**。
10. **打发版 tag**：用户明确要求发版 / 打 tag / 建 Release 时 → 读并执行 [`docs/builtin-workflows/cut-release-tag.md`](./docs/builtin-workflows/cut-release-tag.md)。已有工牌与 remote 后，日常发版只雇本篇。
11. （可选总目录）若同级存在 [`../AgentWikiIndex/`](../AgentWikiIndex/)，改完「能力声明」后执行：
   `python3 ../AgentWikiIndex/scripts/refresh_catalog.py`
   若不存在该目录，**跳过**，不要报错、不要去建。
12. 团队命令在 [`.cursor/commands/team/`](./.cursor/commands/team/)，母版在 Obsidian Vibecoding 团队成员库，命令全文不抄进本文件。
13. **代码检索**：先走 Codebase MCP，不可用再退回文件检索。细则见下节。

## 代码检索

检索本仓符号、调用链、架构或字面量时，按这个顺序：

1. 先用 Codebase Memory MCP（namespace `user-codebase-memory-mcp`，项目名 `Users-peng.zhi-Documents-Codex-0001-HyHarness`）。结构用 `search_graph`、`trace_path`、`get_code_snippet`、`get_architecture`；字面量用 `search_code`。
2. MCP 不可用（未连接、调用失败、索引未就绪）时，再退回仓库内文件检索：Grep、Glob、Read。
3. 图只负责定位。改代码前仍以读到的源文件为准。`check_index_coverage` 报缺口的路径，用文件检索补齐。

## 基线规则

本仓自带；不依赖某家 IDE 的全局规则。若运行时另有全局规则（如 Cursor `~/.cursor/rules/`），一并遵守；冲突时取更严 / 更具体者。

- **设计**：KISS；模块化（高内聚低耦合）；DRY；YAGNI；单一职责
- **质量**：可读性优于简洁；明确优于隐晦
- **协作**：注释解释为什么；优先复用已有组件 / 工具
- **包管理**：npm / pnpm 安装或移除只把命令给用户手动执行；不改 `node_modules` / lockfile；不直接改 `package.json` 依赖字段；新增依赖默认最新稳定版（用户指定版本除外）

## 目录约定

| 目录 | 用途 | 入库 |
|---|---|---|
| `src/main/` | Electron 主进程：注册表、协议、安装 | 是 |
| `src/preload/` | 宿主与插件的预加载脚本（`.cjs`） | 是 |
| `src/renderer/` | 工作台界面：原生 HTML / CSS / JS，无前端构建 | 是 |
| `plugins/` | 内置示例插件，也可放开发软链接 | 是 |
| `test/` | `node:test`，不依赖 Electron | 是 |
| `scripts/` | CLI 入口，一个脚本 = 一个工作流入口 | 是 |
| `skills/` | 可发布成员技能；每个技能一个子目录 `skills/<slug>/` | 是 |
| `assets/` | 输入侧原料与样例 | 目录是；大媒体见 .gitignore |
| `docs/` | 文档，见 docs 约定 | 是 |
| `specs/prds/` | PRD；索引见 `specs/prds/prd-wiki-index.md` | 是 |
| `upgrades/` | 发版说明（GitHub Release 正文）；文件名与 tag 一致；首次发版再建 | 是 |
| `cache/` | 可重建缓存，按内容哈希命名 | 否 |
| `temp/` | 中间产物，可随时清空 | 否 |
| `output/` | 最终产物，按 `output/<主题>/` 归档 | 否 |

约束：`cache/`、`temp/`、`output/` 全部 gitignore；删掉它们不影响代码可运行。根目录已有的工程文件（`package.json`、`README.md`、`tsconfig.json`、`config.dev.example.json`）保留；新的散文件不要再堆到根目录。根目录 `evo_agent_pack.json` 首次发工牌再建（入库）。

### skills/ 约定

- 每个技能独占 `skills/<slug>/`（含 `SKILL.md` 等）；slug = frontmatter `name`；**禁止**以 `huyuan-ai` 开头。
- 共用逻辑放 `src/`；技能专属脚本放该技能内 `scripts/`。

### 升格门槛

- 一次性脚本先放 `temp/<主题>/` 或 `output/<主题>/`；确认还会复用再升到 `src/` / `scripts/` / `skills/`。
- 只有「以后还会复跑」的**业务**流程才写 `docs/workflows/<slug>.md` 并登记进 `docs/doc_index.md`。内置流程不走这条（初始化就有，放在 `docs/builtin-workflows/`）。

## 文档约定

| 路径 | 内容 |
|---|---|
| `docs/doc_index.md` | 唯一入口索引，每行路径 + 一行摘要 |
| `docs/workflows/<slug>.md` | 业务可复跑动作；人/Agent 新建只放这里（入口 / 参数 / 步骤 / 产物 / 排查 / 测试） |
| `docs/builtin-workflows/<slug>.md` | 脚手架自带；改已有文件可以，禁止当业务目录用；每篇必须在「开始工作前」有触发，否则不要新增 |
| `docs/best-practices/<slug>.md` | 可选：项目无关最佳实践（提取经验时再建）；须含 semver `version` |
| `docs/faqs/<问题>.md` | 一次踩坑一篇，文件名即问题 |
| `specs/prds/` | PRD 正文与索引；产品经理写入，工程验收官回写文末状态 |

## 环境

Node 用 **pnpm** 管理。安装或移除依赖只把命令给用户手动执行。

```bash
pnpm test
pnpm build
pnpm start
```

`pnpm test` 不依赖 Electron。`pnpm start` 会先编译主进程再打开工作台。界面保持现有原生 HTML / CSS / JS，不引入 React、Next、shadcn、Alpine 或 Tailwind。

## 能力声明

| 字段 | 值 |
|---|---|
| lifecycle | active |
| owns | 插件扫描与服务注册；app-plugin:// 打开插件界面；zip 安装与卸载；插件 manifest 与 hub.call 契约 |
| not | 在线插件市场；插件产品本体（仓内示例不在本仓演进）；数据库与 HTTP API；把外部项目源码复制进 plugins/ |
