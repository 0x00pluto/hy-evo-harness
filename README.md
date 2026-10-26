# Dex Buddy

Huyuan AI 的统一工作台。宿主用 Electron 扫描插件、注册服务，并用 `app-plugin://` 打开插件界面。插件后端是普通 CommonJS，不需要自己监听端口。插件中心从七牛目录安装，发布见 [docs/workflows/publish-plugin.md](docs/workflows/publish-plugin.md)。

## 安装依赖

本仓库用 pnpm 管理依赖。在仓库根目录执行：

```bash
pnpm add -D electron typescript @types/node electron-builder
pnpm add electron-updater
```

`electron` 必须放在 devDependencies。electron-builder 不允许它出现在 dependencies，否则打包会直接失败。TypeScript 需要 5.7 或更高版本（直接安装最新稳定版即可）。

## 启动与测试

```bash
pnpm test
pnpm start
```

`pnpm test` 不依赖 Electron，覆盖插件扫描、重复 id、卸载清理、路径逃逸和 zip 安装。`pnpm start` 会先编译主进程再打开工作台。

## 目录

```text
src/main/        主进程：注册表、协议、安装
src/preload/     宿主与插件预加载源码（.cts → dist/preload/*.cjs）
src/renderer/    工作台界面
plugins/         示例插件，只在 pnpm start 扫描；也可放开发软链接
```

包类型是 ESM，预加载源码是 `.cts`，由 `tsc` 产出 `dist/preload/*.cjs`，才能在隔离环境里 `require('electron')`。IPC 通道参数与返回值见 `src/shared/dex-ipc.ts`。插件入口 `index.js` 仍按 CommonJS 执行（`module.exports`），不跟随 Dex Buddy 的 `"type": "module"`。插件页面拿不到 Node，只能调用 `window.dex.call`。

## 插件契约

在插件根目录放置 `plugin.manifest.json`：

```json
{
  "id": "ai-comic-master",
  "displayName": "AI 漫剧大师",
  "version": "1.0.0",
  "type": "ui",
  "main": "index.js",
  "uiEntry": "ui/index.html"
}
```

- `id`：小写字母、数字、连字符，最长 64 个字符。
- `type`：`ui` 必须有 `uiEntry`；`headless` 只有后台逻辑。
- `main`、`uiEntry`、`settingsEntry` 必须是插件目录内的相对路径。
- `configSchema`：可选。键名是环境变量名，工作台按它生成设置页。没有声明就不要写空对象。
- `settingsEntry`：可选。插件自带的设置页，和生成的表单读写同一份配置。
- `description`、`icon`、`developer`、`category`、`website`、`privacyPolicy`、`termsOfService`：可选。不写也能加载。图标是插件目录内的 png、jpg、jpeg、webp 或 svg。`category` 会显示在详情里，插件市场也按它分段。发布时，合法的 `category` 和还在目录里的 `icon` 会抄进版本说明。三个链接必须是带主机名的 http(s)。写错的字段不显示，插件仍然加载，也不会进入 `getPluginConfig()` 或 `pluginEnv()`。

`index.js` 导出 `apply` 和可选的 `dispose`：

```javascript
module.exports = {
  apply(ctx) {
    ctx.registerService('aiComicService', {
      async renderVideo(params) {
        return { success: true, prompt: params.prompt };
      },
    });
    ctx.on('trigger-all-spiders', () => {
      ctx.logger.info('开始批量任务');
    });
  },
  dispose() {},
};
```

`ctx` 提供 `registerService`、`getService`、`logger`、`emit`、`on`、`getPluginConfig`、`pluginEnv`、`dirs`。清单声明了 `runtime` 时还有 `runtime`。清单声明了 `externalTools` 且本机 PATH 里已有这些命令时还有 `tools`：键是命令名，值是绝对路径。声明了 `runtime` 时，这些命令的目录在 `ctx.runtime.env` 的 PATH 前面；没有 `runtime` 时在 `pluginEnv()` 里。宿主自己的 `process.env` 不会被改写。卸载时宿主会调用 `dispose`，并移除该插件注册的服务和事件。已安装插件的 `dirs.data` 在 `plugin-data/<id>/`，卸载后保留；`dirs.cache` 在 `plugin-runtime/<id>/cache`，卸载时连同依赖环境一起删除。

`getPluginConfig()` 只返回当前插件已声明的配置。拉起子进程时显式传入环境，不要改宿主的 `process.env`：

```javascript
const { execFile } = require('node:child_process');
execFile(ctx.runtime.python, args, { env: ctx.runtime.env }, callback);
```

配置保存在用户数据目录的 `plugin-settings.json`，不放进插件目录，也不要靠插件目录里的 `.env`。声明非法时插件仍会加载，但这两个方法不会注入该声明。自带设置页通过 `window.dex.readSettings()` / `window.dex.saveSettings(draft)` 读写同一块配置，读到的结果不含已保存的密钥明文。

界面里这样调用服务：

```javascript
const result = await window.dex.call('aiComicService', 'renderVideo', [
  { prompt: '古风修仙场景' },
]);
```

返回值必须能被结构化克隆（普通对象、数组、字符串、数字）。不要从服务方法返回函数或类实例。

后端要用更严的 JavaScript 写法时，见 [docs/plugin-development/typing.md](docs/plugin-development/typing.md)。

仓库里有两个示例，只在 `pnpm start` 出现。安装包不带 `plugins/`。

- `plugins/ai-comic-master`：带界面，`aiComicService.renderVideo` 返回固定结果。
- `plugins/quanmedia-crawl`：无界面，`crawlerService.fetchAccountData`，并监听 `trigger-all-spiders`。

## 开发时挂上现有项目

不要把源码复制进 `plugins/`。已经装好的 Dex Buddy 里，打开插件页，点右上角加号，选「加载本地目录」。可以选插件根（里面直接有 `plugin.manifest.json`），也可以选里面每个子目录是一个插件的文件夹。路径记在用户数据目录的 `unpacked-plugins.json`，重启还在。压缩包从插件页加号的「添加压缩包」安装。

本地目录使用按路径算出的实例 id（`dev-` 加 32 位十六进制），不是清单里的 `id`。设置、`app-plugin://` 和这份实例自己的数据都挂在实例 id 上。同一个清单 id 的已安装插件可以同时留在列表里，两边的密钥和 `plugin-data` 互不影响。移除本地实例不删源码，也不动已安装的那一份。

改完代码后，在该插件详情的「…」里选「重新加载」，不用退出 Dex Buddy。上线前可以选「按发布预览」：文件集和依赖安装与插件中心相同，仍然用这份实例的设置。结束预览后回到源码目录。

维护者用未打包的 `pnpm start` 时，还可以把绝对路径写进已忽略的 `config.dev.json` → `extraPluginPaths`。这些路径同样用实例 id，界面里不能移除；要停用就改 JSON 后重启。打包后的 Dex Buddy 不读这个文件。`forceUpdateIcon` 设为 `true` 时，开发版会显示下载图标并打开和线上一样的确认框；确认不会下载或安装。打包后这个开关无效。未设置时，未打包与安装包默认网关都是 `https://www.dexbuddy.app`。需要打其它环境时，可用环境变量 `DEX_GATEWAY_BASE_URL`（优先）或未打包的 `config.dev.json` → `gatewayBaseUrl` 覆盖；指向本机（例如 `http://localhost:3000`）只供显式调试，不是默认路径。登录走系统浏览器与 `dexbuddy://auth/callback`；凭证只留在主进程（refresh 经 `safeStorage`），界面只看到脱敏手机号与余额。

软链接仍然可以放进 `plugins/`，但只有未打包运行会扫到，并用清单 id，和已安装插件共用设置。要隔离就改用插件页加载。

```bash
ln -s "/绝对路径/你的项目" "/绝对路径/0001-HyHarness/plugins/你的项目"
```

## 打包给别人安装

打成 zip，包含 `plugin.manifest.json`、`index.js`、`ui/` 和需要的静态资源。排除 `.git`、`.venv`、`node_modules`、`bin/`、缓存和生成产物。解释器不打进这个 zip，也不打进 Dex Buddy 安装包。

```bash
cd plugins
zip -r ../ai-comic-master-v1.0.0.zip ai-comic-master -x '*.DS_Store' -x '*node_modules*'
```

从图标轨的拼图进入插件页，加号里选「添加压缩包」。宿主解压到用户数据目录的 `installed_plugins/<id>/`，校验 manifest 后出现在插件列表里。欢迎页不接受拖放，压缩包只从插件页加号进入。只有这样安装的插件可以卸载。未打包运行里，同清单 id 已由示例目录加载时，安装会被拒绝。打包后的 Dex Buddy 没有示例目录。本地目录是另一条实例，不挡住同一个清单 id 的安装。

## 桌面安装包与自动更新

本地打包：

```bash
pnpm build:mac
pnpm build:win
pnpm build:linux
```

产物在 `release/`。推送 `v*` 标签后，GitHub Actions 打包三端并创建 Release 页，说明由提交记录自动生成，同时把 Windows 与 macOS 的更新文件上传到七牛。已安装的 Windows 客户端可静默更新；macOS 在未签名时从七牛下载 dmg，打开后退出，再手动安装。细节见 [docs/build-and-release.md](docs/build-and-release.md)。
