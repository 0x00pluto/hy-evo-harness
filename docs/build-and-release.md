# 打包与发布

Dex Buddy 使用 TypeScript 编译主进程，再用 electron-builder 产出桌面安装包。跨平台构建由 GitHub Actions 完成。界面仍是原生 HTML / CSS / JS，没有前端构建。

## 本地打包

在已安装依赖的前提下。`electron` 必须在 `devDependencies`；若它还在 `dependencies`，先执行 `pnpm remove electron`，再执行 `pnpm add -D electron`。

| 命令 | 说明 |
| --- | --- |
| `pnpm build:mac` | 构建并打包 macOS（dmg 与 zip） |
| `pnpm build:win` | 构建并打包 Windows |
| `pnpm build:linux` | 构建并打包 Linux |
| `pnpm build:unpack` | 构建后产出未封装的目录（`--dir`），便于本地检查 |

`pnpm build` 只运行 `tsc`，不调用 electron-builder。主进程编译结果在 `dist/`。安装包在 `release/`，避免和 `dist/` 混在一起。

## CI 自动构建

工作流：[`.github/workflows/build-all-platforms.yml`](../.github/workflows/build-all-platforms.yml)

### 触发条件

1. **推送版本标签**（推荐）：匹配 `v*`，例如 `v0.1.0`、`v1.2.3`。
2. **手动运行**：在 GitHub 仓库的 Actions →「Build All Platforms」→ Run workflow。

推送到 `main` **不会**触发该工作流。

### 发版

日常发版走 [cut-release-tag.md](./builtin-workflows/cut-release-tag.md)：对齐 `package.json` 的 `version`、写 `upgrades/`、打 `vX.Y.Z` tag 并推送。**不要**在本地或网页再创建 GitHub Release，否则会和 CI 抢同一个 tag。

tag 去掉 `v` 之后必须等于 `package.json` 的 `version`，否则 CI 校验失败。

### CI 产物

| Job | 平台 | Artifact 名称 | 主要文件 |
| --- | --- | --- | --- |
| Build macOS Universal | macOS | `dex-buddy-macos-universal` | `.dmg`、`-mac.zip`、`latest-mac.yml` 等 |
| Build Windows x64 | Windows | `dex-buddy-windows-x64` | `.exe`、`latest.yml`、`.blockmap` |
| Build Linux x64 | Linux | `dex-buddy-linux-x64` | `.AppImage`、`.deb`、`latest-linux.yml` 等 |

Artifact 保留 14 天，可在对应 Workflow Run 页面下载。CI 使用 `--publish never`，electron-builder 不会自己上传。上传由下面的 release job 完成。

Linux CI 产出 AppImage + deb（不含 snap，避免 snapcraft 依赖导致失败）。

### GitHub Release（自动）

三端构建完成后，`release` job 仅在 `v*` 标签触发时运行：下载各平台 Artifact，用 `softprops/action-gh-release` 基于当前 tag 创建 GitHub Release，并把安装包（dmg / exe / AppImage / deb 等）作为 Release Assets 上传。用户可直接在仓库 Releases 页面按系统下载。

- 手动 `workflow_dispatch`（无 tag）不会创建 Release，只产出 Actions Artifact。
- 该 job 单独授予 `contents: write` 权限（工作流顶层仍为只读）。
- Release 说明由 `generate_release_notes: true` 按提交自动生成。`upgrades/` 是仓内发版记录，不作为这页正文。

## 自动更新

应用内自动更新基于 electron-updater，更新源为本仓库的 GitHub Releases（`electron-builder.yml` 的 `publish: provider: github`，仓库 `0x00pluto/hy-evo-harness`）。不使用系统通知。入口是侧栏底部的向上箭头。

`appId` 固定为 **`com.huyuan.dexbuddy`**。这次改名之后不要再改，否则已安装客户端对不上更新身份。

### 共同行为

- 生产环境启动时检查更新，运行期间每 6 小时复查；开发模式（`pnpm start`）不检查。
- 仅接收正式稳定版 Release（忽略 draft / prerelease）。
- 更新状态由主进程维护，经预加载脚本的四个通道推到界面：查询状态、订阅状态、重试、安装。界面不能传入下载地址。
- 检查或下载连续失败时，主区域状态行提示并提供「重试」；第一次失败静默重试一次。

### Windows（完整自动更新）

- 发现新版本后后台静默下载；下载完成后侧栏显示向上箭头。
- 点击箭头确认「立即重启并更新」或「稍后」；立即路径安装后自动重启；稍后并正常退出时自动安装。
- 存在运行中任务时阻止立即重启。当前任务查询固定返回没有任务，接口留在主进程。

### macOS（下载 dmg 手动安装）

- 当前未配置 Apple 签名/公证（`identity: null`），不走 electron-updater 静默安装。
- 检测到新版本即显示箭头；用户确认后主进程从 GitHub Release 下载 `dex-buddy-${version}.dmg` 到系统「下载」目录，完成后自动打开。
- 用户需手动将应用拖入「应用程序」。未签名包首次打开可能需要在系统设置里放行。
- 同版本 dmg 已存在且大小匹配时不重复下载，直接打开本地文件。

### Linux

CI 会上传 Linux 安装包。应用内不检查、不安装更新。

### Release 资产要求

Release Assets 中的 `latest*.yml`、`.dmg` / `.exe` 与 `*.blockmap` 是更新元数据与安装包：不要删除这些 Assets，否则已装客户端无法检测或完成更新。

本地开发调试更新流程用根目录 `dev-app-update.yml`。这个文件不会打进安装包。

## electron-builder 关键配置

配置文件：[electron-builder.yml](../electron-builder.yml)

| 项 | 说明 |
| --- | --- |
| `appId` / `productName` | `com.huyuan.dexbuddy` / `Dex Buddy` |
| 输出目录 | `release/`，与 `tsc` 的 `dist/` 分开 |
| 打包内容 | `dist/`、`src/renderer/`、`src/preload/`、`plugins/`，以及生产依赖 `electron-updater` |
| `mac` | 本地与 CI 都产出 dmg 与 zip；签名默认 `identity: null`，`notarize: false` |
| `win` / `nsis` | 可执行名 `DexBuddy`，安装包名 `dex-buddy-${version}-setup.exe`；`build/installer.nsh` 让更新后直接启动 exe |
| `linux` | 本地默认含 AppImage / snap / deb；CI 仅打 AppImage + deb |
| `publish` | GitHub Releases（`0x00pluto/hy-evo-harness`）；构建仍用 `--publish never` |
