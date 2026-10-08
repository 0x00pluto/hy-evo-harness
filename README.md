# Huyuan Hub

Huyuan AI 统一工作台。宿主用 Electron 扫描插件、注册服务，并用 `app-plugin://` 打开插件界面。插件后端是普通 CommonJS，不需要自己监听端口。

在线插件市场不在当前版本里。

## 安装依赖

本仓库用 pnpm 管理依赖。在仓库根目录执行：

```bash
pnpm add electron
pnpm add -D typescript @types/node
```

TypeScript 需要 5.7 或更高版本（直接安装最新稳定版即可）。

## 启动与测试

```bash
pnpm test
pnpm start
```

`pnpm test` 不依赖 Electron，覆盖插件扫描、重复 id、卸载清理、路径逃逸和 zip 安装。`pnpm start` 会先编译主进程再打开工作台。

## 目录

```text
src/main/        主进程：注册表、协议、安装
src/preload/     宿主与插件的预加载脚本（.cjs）
src/renderer/    工作台界面
plugins/         内置示例插件，也可放开发软链接
```

包类型是 ESM，所以预加载脚本使用 `.cjs`，才能在隔离环境里 `require('electron')`。插件入口 `index.js` 仍按 CommonJS 执行（`module.exports`），不跟随 Hub 的 `"type": "module"`。插件页面拿不到 Node，只能调用 `window.hub.call`。

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
- `main` 和 `uiEntry` 必须是插件目录内的相对路径。

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

`ctx` 提供 `registerService`、`getService`、`logger`、`emit`、`on`。卸载时宿主会调用 `dispose`，并移除该插件注册的服务和事件。

界面里这样调用服务：

```javascript
const result = await window.hub.call('aiComicService', 'renderVideo', [
  { prompt: '古风修仙场景' },
]);
```

返回值必须能被结构化克隆（普通对象、数组、字符串、数字）。不要从服务方法返回函数或类实例。

仓库里有两个示例：

- `plugins/ai-comic-master`：带界面，`aiComicService.renderVideo` 返回固定结果。
- `plugins/quanmedia-crawl`：无界面，`crawlerService.fetchAccountData`，并监听 `trigger-all-spiders`。

## 开发时挂上现有项目

不要把源码复制进 `plugins/`。任选一种方式：

1. 复制 `config.dev.example.json` 为 `config.dev.json`，把项目绝对路径写进 `extraPluginPaths`。这个文件已忽略，只在未打包时读取。路径可以是「里面放了多个插件的目录」，也可以是「自身就有 manifest 的项目根」。
2. 做软链接：

```bash
ln -s "/绝对路径/你的项目" "/绝对路径/0001-HyHarness/plugins/你的项目"
```

改完插件代码后重启 Hub。同名 `id` 先加载的保留，后扫描到的跳过。顺序是：`plugins/`、`config.dev.json`、用户安装目录。

## 打包给别人安装

打成 zip，包含 `plugin.manifest.json`、`index.js`、`ui/` 和需要的静态资源。排除 `.git`、`.venv`、`node_modules`、缓存和生成产物。

```bash
cd plugins
zip -r ../ai-comic-master-v1.0.0.zip ai-comic-master -x '*.DS_Store' -x '*node_modules*'
```

在工作台把 zip 拖进欢迎页，或点击「安装插件」。宿主解压到用户数据目录的 `installed_plugins/<id>/`，校验 manifest 后立刻出现在侧边栏。只有这样安装的插件可以卸载。内置插件和开发路径里的插件不能被安装包覆盖。
