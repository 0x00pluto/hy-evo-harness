# Document index

## Index

- `README.md`: Dex Buddy 产品说明：Electron 宿主、插件契约、开发挂载与打包
- `docs/DESIGN.md`: 工作台壳视觉事实源：白底、浅灰选中、细线文字按钮、双色独角兽字标；图标轨拼图打开插件市场；标题栏前进右侧有重新加载（refresh-cw），只在工作区显示界面插件时出现且不参与拖拽；本地实例的重新加载从源码重挂后端，已安装只刷新页面；顶栏下方 toast 用现有色令牌；控件第二次出现再抽到 src/renderer/ui/；改 src/renderer 外观前先读
- `docs/build-and-release.md`: 桌面安装包、三端 CI、GitHub Release 页，以及从七牛下载的应用内自动更新；解释器单独用 publish-runtimes 传到 dex-buddy/runtimes/，不打进安装包
- `docs/hub-plugin-architecture.md`: Dex Buddy 插件化技术选型与方案原文备份：注册表、app-plugin 协议、开发挂载、ZIP 安装；第一期插件中心见 publish-plugin 工作流，不改技能中心
- `docs/memo/phase1-billing.md`: 第一期收费备忘（未上线）：登录与买断、额度充值包、网关转发模型并扣费；提示词仍本机拼；破解靠服务端校验；Chat 对齐 OpenAI 形态、生图包一层不透传 Replicate
- `docs/memo/phase1-roadmap-and-skills-gate.md`: 第一期之后备忘：上线门槛与 P1.5–P5 Roadmap；huyuan-ai-skills-gate 可借鉴（登录/支付/权益门禁）与勿照搬（无用量钱包、勿整仓 fork）
- `docs/plugin-development.md`: 插件开发说明已拆到 `docs/plugin-development/`，本文件只保留入口
- `docs/plugin-development/README.md`: 可单独转发的插件开发目录：交什么、两种插件，以及清单、设置、数据、运行、后端 JavaScript、打包、发布、插件中心、配色的入口
- `docs/plugin-development/manifest.md`: plugin.manifest.json 字段与图标尺寸、画布、格式
- `docs/plugin-development/settings.md`: configSchema、分组、密钥输入与眼睛、settingsEntry、pluginEnv；保存后下次读取即新值，没有保存事件
- `docs/plugin-development/data.md`: 插件页加载的本地实例数据仍在仓库，设置和 plugin-data 用实例 id，与清单 id 隔离；装进 installed_plugins 之后 ctx.dirs 分开，卸载只删运行环境和缓存
- `docs/plugin-development/runtime.md`: index.js 跑在 Electron 的 Node 里；清单声明 runtime 后由宿主准备钉死版本的 Python 或官方 Node；externalTools 在 apply 前只查 PATH，缺了给可复制的安装说明，ctx.tools 给绝对路径；未声明的命令仍靠本机 PATH；pluginEnv 与 runtime.env 每次读取都是当前已保存配置；dex.call 参数须可 JSON 序列化，宿主 IPC 前再圆整一次
- `docs/plugin-development/typing.md`: 后端严格 JavaScript 约定：`@ts-check`、JSDoc、禁止 any；入口仍是 index.js，不编译 dist，宿主不因检查失败拒载
- `docs/plugin-development/pack.md`: 插件中心打包：宿主默认丢掉密钥和虚拟环境；dex-buddy-plugin.pack 指定要装的路径，dex-buddy-plugin.ignore 再挖掉
- `docs/plugin-development/ship.md`: 插件页加载本地目录、重新加载从源码重挂后端并清 require 缓存、zip 拖进工作台安装，以及会加载失败的情况
- `docs/plugin-development/distribute.md`: 插件作者发到插件中心：仓库进授权名单后只推 tag；zip 按 pack.md 从 tag 里取；runtime 在清单里声明，不再用 dex-buddy-plugin-pack.json 打三端二进制
- `docs/plugin-development/color.md`: 插件页面配色建议：中性色可粘贴，也可自选颜色；壳不检查
- `AGENTS.md`: 本仓工作约定、目录语义与能力声明；代码检索先走 Codebase MCP；scaffold_version 2.4.0
- `docs/builtin-workflows/post-task-reflect.md`: 任务后反思（白痴指数 → 删 → 程序化 → 鲁棒 → 加速）；用户明确要求时触发，不自动跑
- `docs/builtin-workflows/extract-experience.md`: 提取经验 → 项目无关最佳实践；用户明确要求时触发；落盘须问或读 experience_target，默认本仓 docs/best-practices/
- `docs/builtin-workflows/consolidate-memory.md`: 记忆巩固与遗忘（冲突消解 → 情景提纯 → 剪枝）；仅用户显式触发；与反思 / 提取经验互不串联
- `docs/builtin-workflows/cut-release-tag.md`: 日常发版唯一入口；汇总变更 → upgrades → 对齐 package.json version → tag → 推送；Release 页由 Actions 创建，不要本地 gh release create；major 须人指定
- `docs/workflows/_TEMPLATE.md`: 业务 workflow 六段骨架；新建业务工作流时复制并改名，写完后删掉本行或改成真实条目
- `docs/workflows/publish-plugin.md`: 维护者把插件仓库写入授权名单后，同步工作流拉取最高 vX.Y.Z 上传七牛；版本说明可带 category 和 iconUrl，已有 zip 不补传图标；仓库里若还有 dex-buddy-plugin-pack.json 则失败；同事机器上的市场插件在启动和每 6 小时静默更新，正在看的离开时再查目录并安装
- `specs/prds/prd-wiki-index.md`: PRD 索引；正文为 `specs/prds/prd-{五位序号}-{feature-slug}.md`，本索引不计入序号
- `.cursor/commands/team/`: 团队命令（产品经理、工程验收官、前端工程师、测试工程师、自主交付工程师）；母版在 Obsidian，不在此复制全文
- `docs/renderer-layout.md`: 设置页和插件页共用一份 #split-layout；以后在第四个分栏表面把间距改散，或单页拼 DOM 超过约 800 行时，再引入 Lit 具名插槽，本次不安装
- `docs/faqs/how-to-prevent-popup-clipping.md`: 工作台弹出层不要绝对定位在 overflow 容器里；用 fixed 按按钮摆放，否则只剩一条
