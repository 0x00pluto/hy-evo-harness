# 宿主（Electron）错误如何收集（已讨论，不立项）

插件页失败已有 00022：看得见、能一键复制。宿主自己（主进程 / 壳渲染 / 原生崩溃）仍可能无字可抄。本篇对照 **Electron 现成能力** 与可选第三方，记下以后若立项怎么选。本轮不写 PRD、不改代码、不加依赖。

关联：`specs/prds/prd-00022-plugin-page-diagnostics.md`、`docs/faqs/plugin-page-blank-no-error.md`。

---

## 起因与分界

| 对象 | 谁管 | 现状 |
|---|---|---|
| 插件 webview 资源 404 / console warning·error | PRD 00022 | 粉红「插件报错」条 + 悬停卡 / 详情「一键复制错误信息」 |
| 宿主主进程、壳 `BrowserWindow` 渲染、Crashpad 原生崩溃 | 本备忘 | 仓内无统一钩子；局部靠 `setStatus` / toast；打包用户看不见主进程控制台 |

插件 guest 继续归 00022，不要再在宿主诊断里重记一遍 webview console。

## 仓内现状（核对）

- 无 `crashReporter.start`
- 无全局 `process.on('uncaughtException'|'unhandledRejection')`
- 无壳层 `window` 的 `error` / `unhandledrejection` 统一收集
- `package.json` 无 electron-log / Sentry 等崩溃 SDK

## 调研方案对照

每条都是现成路径，不自造遥测协议。

### 方案 A — Electron 官方 JS 钩子 + 本机一键复制（对齐 00022）

| | |
|---|---|
| **管什么** | 主进程未捕获异常 / 未处理 Promise；壳渲染（工作台 HTML/JS）的 `error`、`unhandledrejection`。**不是**插件 webview。 |
| **怎么接** | `process.on('uncaughtException'|'unhandledRejection')`；壳侧 `window` 监听。内存环形缓冲；现有 `copyText`；UI 用「工作台报错」一类文案 +「一键复制错误信息」，与插件条区分开。 |
| **优点** | 零新依赖；断网可用；隐私模型与 00022 一致（剪贴板、不默认上传）。 |
| **代价** | 管不了原生崩溃（segfault、OOM、致命 V8 等）；主进程已死时界面可能来不及抄。 |
| **与本仓** | 最贴「别造轮子、先能抄给支持」。 |

### 方案 B — Electron `crashReporter`（Crashpad），先关上传

| | |
|---|---|
| **管什么** | 原生崩溃 minidump（Chromium Crashpad）。须在 `app.whenReady` **之前** `crashReporter.start`，之后创建的渲染 / GPU 等子进程才会被监视。 |
| **怎么接** | 官方 `crashReporter`；`uploadToServer: false` 时仍写入 `app.getPath('crashDumps')`；用户同意后再 `setUploadToServer(true)`。文档：[崩溃报告](https://www.electronjs.org/zh/docs/latest/tutorial/crash-reporting)、[`crashReporter` API](https://www.electronjs.org/zh/docs/latest/api/crash-reporter)。 |
| **优点** | 官方、不自造 dump 格式；闪退仍有落盘痕迹。 |
| **代价** | minidump 对人不可读，要符号化或服务端解析才有用；**明确不管**普通 JS 异常（Electron 维护者说明：crashReporter 面向 crash，不是 uncaught JS）。 |
| **与本仓** | 补「闪退无痕」；须与 A 搭配才覆盖完整。 |

### 方案 C — `crashReporter` + submitURL 上传

| | |
|---|---|
| **管什么** | 同 B，外加向 `submitURL` POST minidump（可自建接收端或兼容 Crashpad 的服务）。 |
| **优点** | 支持侧集中看崩溃，不必用户手动拷文件。 |
| **代价** | 要崩溃收集服务、隐私同意与运维；与当前「本机产品、默认不上报」张力大。 |
| **与本仓** | 有运维与合规拍板后再说；默认列为以后可选。 |

### 方案 D — Sentry Electron SDK（或同类）

| | |
|---|---|
| **管什么** | 主 / 渲染 JS 异常 + 可接原生崩溃（一体化产品）。文档：[Sentry for Electron](https://docs.sentry.io/platforms/javascript/guides/electron/)。 |
| **优点** | 现成产品、少自建接线。 |
| **代价** | 新 npm 依赖、账号与数据出境 / 合规；默认走向「自动上报」。 |
| **与本仓** | 仅当明确要云端聚合时再选；备忘不默认推荐。 |

### 不推荐当主路径

- 自研 APM / 观测平台
- 空 DOM / 启发式猜「宿主白了」
- 误用 `did-fail-load` 当宿主诊断（00022 已否决拿它捕子资源；宿主也同理别滥用）
- 只写 `console.log`、无复制口（安装包用户看不见）

## 推荐组合（仍不立项）

若以后开工：优先 **A + B（`uploadToServer: false`）**。

- A：还能看见界面时的 JS 失败 → 与 00022 同级的「看见 + 一键复制」
- B：闪退 / 原生崩溃 → 本机 dump 落盘，不默认上传

C / D 单列「需产品拍板上报与依赖」。

## 以后立项前要拍板

1. 是否允许任何自动上报（默认：**否**）
2. 首期是否包含 crash dump 落盘（B），还是只做 A

## 不做（本轮）

- 不写 PRD、不改 `src/`、不新增依赖
- 不把插件 webview 诊断并进本篇重做
- 不默认开启崩溃上传
