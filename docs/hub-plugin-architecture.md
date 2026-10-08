# Huyuan Hub 插件化技术选型与方案（备份）

本文是方案原文的备份，记录整套轻量插件化 Hub 的技术选型。上半部分是落地时已经采纳的选型；下半部分按原稿保留，方便对照，不改原文措辞。

日常接入步骤以 [README.md](../README.md) 为准。在线插件市场不在当前版本。

## 落地选型

相对原稿，落地时固定了这些选择：

| 议题 | 原稿 | 落地 |
|---|---|---|
| 插件页面权限 | `nodeIntegration: true`，页面里 `require('electron')` | 宿主和 `<webview>` 都关闭 Node，`contextIsolation: true`。页面只调用 `window.hub.call(serviceName, method, args)` |
| 静态资源协议 | `protocol.registerFileProtocol` | 启动前 `registerSchemesAsPrivileged`，就绪后 `protocol.handle`。按插件真实目录 `absPath` 解析，拒绝逃出插件目录 |
| 插件上下文 | `apply` 拿到整个注册表 | `apply` 期间登记的服务和事件记在该插件名下，`unload` 时一并摘掉 |
| 扫描根 | 只扫 `plugins/` 子目录 | 既扫「里面放多个插件的目录」，也扫「自身就有 manifest 的项目根」 |
| 同名插件 | 已加载则跳过 | 扫描顺序固定：仓库 `plugins/`、未打包时的 `config.dev.json`、`userData/installed_plugins/`。先加载的保留 |
| 开发挂载 | 软链接，或多目录扫描 | 两种都保留。外部路径写在已忽略的 `config.dev.json` → `extraPluginPaths` |
| 安装包 | `adm-zip` 或 `unzipper` | 使用 macOS 自带 `unzip`，不增加解压依赖。解压前拒绝绝对路径和 `..` |
| 卸载 | 未写界面 | 只有安装到用户目录的插件可卸载。内置示例和开发路径不能被安装包覆盖 |
| 在线市场 | 作为商业化扩展写出 | 当前版本不做 |
| 依赖 | 零框架，示例里出现解压库 | 运行时依赖只有 Electron。插件后端保持 CommonJS。包管理用 pnpm |
| 预加载脚本 | 未单列 | 宿主与插件各一份预加载脚本，扩展名 `.cjs`（本仓 `package.json` 为 ESM） |
| 界面 | `<webview>` + 侧边栏 | 保留。`ui` 插件进独立 `partition`；`headless` 在主区域说明已在后台运行，不用 `alert` |

插件契约、示例目录和安装闭环仍按下面原稿执行。

## 方案原文

这是一套不依赖任何第三方复杂框架、100% 自研、架构纯粹且工业级的轻量插件化 Hub 落地方案。

整套方案分为三部分：

1. Core / Service Registry（宿主核心注册表与生命周期）
2. Electron Hub 宿主架构与主界面
3. 子项目（插件）接入规范与代码示例

### 一、核心架构设计与目录结构

```text
hub-app/
├── package.json
├── src/
│   ├── main/                  # Electron 主进程
│   │   ├── index.ts           # 主进程入口
│   │   ├── registry.ts        # 核心服务注册表 (Service Registry)
│   │   ├── types.ts           # 插件系统类型定义
│   │   └── protocol.ts        # 自定义协议 (解决静态文件与安全性)
│   └── renderer/              # Hub 宿主前端 UI
│       ├── index.html         # 工作台大厅 HTML
│       ├── app.ts             # 导航与 View 切换逻辑
│       └── style.css
└── plugins/                   # 插件存放目录 (项目组)
    ├── ai-comic-master/       # 示例：AI 漫剧大师
    │   ├── plugin.manifest.json
    │   ├── index.js           # 插件后端/计算逻辑
    │   └── ui/                # 插件前端 UI
    └── quanmedia-crawl/       # 示例：无 UI 的自动化爬虫
        ├── plugin.manifest.json
        └── index.js
```

### 二、核心代码实现

#### 1. 插件类型定义（`src/main/types.ts`）

定义宿主与插件之间交互的标准契约：

```typescript
export interface AppContext {
  // 服务管理
  registerService: <T = any>(name: string, service: T) => void;
  getService: <T = any>(name: string) => T | undefined;

  // 日志输出
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
  };

  // 跨插件事件通道
  emit: (event: string, ...args: any[]) => void;
  on: (event: string, handler: (...args: any[]) => void) => void;
}

export interface PluginManifest {
  id: string;               // 唯一ID，如 "ai-comic-master"
  displayName: string;      // 界面显示名称
  version: string;
  type: 'ui' | 'headless';  // ui: 带有界面的应用, headless: 纯后台逻辑
  main?: string;            // 后端逻辑入口文件，如 "index.js"
  uiEntry?: string;         // UI 界面入口，如 "ui/index.html"
}

export interface AppPlugin {
  manifest: PluginManifest;
  absPath: string;
  apply: (ctx: AppContext) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}
```

#### 2. 服务注册表与调度中心（`src/main/registry.ts`）

负责插件的扫描、依赖注入、事件订阅以及优雅卸载（Dispose）：

```typescript
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { AppContext, AppPlugin, PluginManifest } from './types';

export class ServiceRegistry implements AppContext {
  private services = new Map<string, any>();
  private plugins = new Map<string, AppPlugin>();
  private bus = new EventEmitter();

  public logger = {
    info: (msg: string) => console.log(`[Plugin Hub INFO] ${msg}`),
    error: (msg: string) => console.error(`[Plugin Hub ERROR] ${msg}`)
  };

  registerService<T = any>(name: string, service: T): void {
    if (this.services.has(name)) {
      this.logger.error(`Service '${name}' 已存在，拒绝重复注册`);
      return;
    }
    this.services.set(name, service);
  }

  getService<T = any>(name: string): T | undefined {
    return this.services.get(name);
  }

  emit(event: string, ...args: any[]): void {
    this.bus.emit(event, ...args);
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.bus.on(event, handler);
  }

  // 扫描并动态挂载 plugins 目录下的插件
  async scanAndLoadPlugins(pluginsRootDir: string) {
    if (!fs.existsSync(pluginsRootDir)) return;

    const folders = fs.readdirSync(pluginsRootDir);

    for (const folder of folders) {
      const pluginDir = path.join(pluginsRootDir, folder);
      const manifestPath = path.join(pluginDir, 'plugin.manifest.json');

      if (fs.existsSync(manifestPath)) {
        try {
          const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

          let pluginModule: any = {};
          if (manifest.main) {
            const entryPath = path.join(pluginDir, manifest.main);
            // 动态 require 加载插件后端代码
            delete require.cache[require.resolve(entryPath)];
            pluginModule = require(entryPath);
          }

          const plugin: AppPlugin = {
            manifest,
            absPath: pluginDir,
            apply: pluginModule.apply || (() => {}),
            dispose: pluginModule.dispose || (() => {})
          };

          await this.loadPlugin(plugin);
        } catch (err) {
          this.logger.error(`加载插件 [${folder}] 失败: ${err}`);
        }
      }
    }
  }

  async loadPlugin(plugin: AppPlugin) {
    if (this.plugins.has(plugin.manifest.id)) return;

    this.logger.info(`挂载插件: ${plugin.manifest.displayName} (${plugin.manifest.id})`);
    await plugin.apply(this);
    this.plugins.set(plugin.manifest.id, plugin);
  }

  async unloadPlugin(id: string) {
    const plugin = this.plugins.get(id);
    if (plugin) {
      if (plugin.dispose) {
        await plugin.dispose();
      }
      this.plugins.delete(id);
      this.logger.info(`卸载插件: ${plugin.manifest.displayName}`);
    }
  }

  getPluginList() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.manifest.id,
      displayName: p.manifest.displayName,
      type: p.manifest.type,
      // 构造安全的文件访问路径
      uiUrl: p.manifest.uiEntry ? `app-plugin://${p.manifest.id}/${p.manifest.uiEntry}` : null
    }));
  }
}
```

#### 3. Electron 主进程集成（`src/main/index.ts`）

为了告别随机 HTTP 端口冲突，这里注册了一个自定义协议 `app-plugin://`，让 Electron 直接以近乎 native 的安全速度渲染本地 HTML 资源：

```typescript
import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { ServiceRegistry } from './registry';

const registry = new ServiceRegistry();

// 注册自定义安全协议 app-plugin://<plugin-id>/ui/index.html
function registerCustomProtocol() {
  protocol.registerFileProtocol('app-plugin', (request, callback) => {
    const url = request.url.replace('app-plugin://', '');
    const firstSlash = url.indexOf('/');
    const pluginId = url.substring(0, firstSlash);
    const filePath = url.substring(firstSlash + 1);

    const pluginsList = registry.getPluginList();
    const targetPlugin = pluginsList.find(p => p.id === pluginId);

    if (targetPlugin) {
      // 获取真实的磁盘物理路径
      const pluginsDir = path.join(__dirname, '../../plugins');
      const realPath = path.join(pluginsDir, pluginId, filePath);
      callback({ path: realPath });
    } else {
      callback({ error: -6 }); // FILE_NOT_FOUND
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Huyuan AI 工作台 Hub",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true // 开启 Webview 容器支持
    }
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  registerCustomProtocol();

  // 1. 挂载全局内置 IPC 监听，供渲染进程查询插件列表和调用插件能力
  ipcMain.handle('get-plugin-list', () => registry.getPluginList());

  ipcMain.handle('call-plugin-service', async (_, { serviceName, method, args }) => {
    const service = registry.getService(serviceName);
    if (!service || typeof service[method] !== 'function') {
      throw new Error(`服务或方法不存在: ${serviceName}.${method}`);
    }
    return await service[method](...args);
  });

  // 2. 扫描并加载 plugins 目录下的插件
  const pluginsPath = path.join(__dirname, '../../plugins');
  await registry.scanAndLoadPlugins(pluginsPath);

  createWindow();
});
```

### 三、Hub 宿主前端 UI 实现

#### 1. HTML 大厅视图（`src/renderer/index.html`）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>应用工作台 Hub</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- 左侧统一侧边栏 -->
  <div id="sidebar">
    <div class="brand">Huyuan Hub</div>
    <div class="section-title">可用的应用与工具</div>
    <div id="plugin-nav"></div>
  </div>

  <!-- 右侧主应用渲染区 -->
  <div id="main-container">
    <div id="welcome-screen">
      <h2>欢迎使用 Huyuan AI 统一工作台</h2>
      <p>请在左侧选择需要运行的应用或工具。</p>
    </div>
    <!-- 动态嵌入插件 UI 的 Webview 容器 -->
    <webview id="plugin-viewport" src="about:blank" style="display: none;"></webview>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

#### 2. 前端控制逻辑（`src/renderer/app.js`）

```javascript
const { ipcRenderer } = require('electron');

const navContainer = document.getElementById('plugin-nav');
const viewport = document.getElementById('plugin-viewport');
const welcomeScreen = document.getElementById('welcome-screen');

async function renderHub() {
  // 从主进程获取所有注册成功的插件
  const plugins = await ipcRenderer.invoke('get-plugin-list');
  navContainer.innerHTML = '';

  plugins.forEach(plugin => {
    const btn = document.createElement('div');
    btn.className = 'nav-item';
    btn.innerHTML = `
      <span class="icon">${plugin.type === 'ui' ? '📱' : '⚙️'}</span>
      <span class="title">${plugin.displayName}</span>
    `;

    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');

      if (plugin.type === 'ui' && plugin.uiUrl) {
        welcomeScreen.style.display = 'none';
        viewport.style.display = 'flex';
        // 使用自定义协议直接加载，不占端口、安全高效
        viewport.src = plugin.uiUrl;
      } else {
        alert(`工具 [${plugin.displayName}] 是纯后台服务，已在系统后台静默运行中。`);
      }
    };

    navContainer.appendChild(btn);
  });
}

renderHub();
```

### 四、各子项目（插件）如何接入

子项目完全不需要知道 Electron 的存在，按照下述两种规范接入即可。

#### 接入场景 A：带界面的项目（如 AI 漫剧大师）

##### 1. 放置配置文件 `plugins/ai-comic-master/plugin.manifest.json`

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

##### 2. 后端入口 `plugins/ai-comic-master/index.js`

无缝暴露生成算力与服务，无需监听任何 800X 端口：

```javascript
module.exports = {
  apply(ctx) {
    ctx.logger.info("AI 漫剧大师后端核心已成功挂载！");

    // 注册服务，供 Hub 统一调度或其它插件调用
    ctx.registerService("aiComicService", {
      async renderVideo(params) {
        ctx.logger.info(`收到渲染请求，提示词: ${params.prompt}`);
        // 实际的 Python 脚本或算法调用...
        return { success: true, videoPath: "/outputs/demo.mp4" };
      }
    });
  },

  dispose() {
    console.log("AI 漫剧大师已回收所有计算资源。");
  }
};
```

##### 3. 前端界面 `plugins/ai-comic-master/ui/index.html`

前端 HTML 只需要通过极为干净的 API 触发后端逻辑，不需要知道底层端口：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AI 漫剧大师</title>
</head>
<body>
  <h1>AI 漫剧大师创作台</h1>
  <button id="btn">生成漫剧</button>

  <script>
    const { ipcRenderer } = require('electron');

    document.getElementById('btn').onclick = async () => {
      // 调用宿主注册的 Service，不走 HTTP 端口，纯内存/IPC 级别通信
      const result = await ipcRenderer.invoke('call-plugin-service', {
        serviceName: 'aiComicService',
        method: 'renderVideo',
        args: [{ prompt: "古风修仙场景" }]
      });
      alert("生成结果：" + JSON.stringify(result));
    };
  </script>
</body>
</html>
```

#### 接入场景 B：无 UI 纯脚本项目（如全媒体爬虫）

配置文件 `plugins/quanmedia-crawl/plugin.manifest.json`：

```json
{
  "id": "quanmedia-crawl",
  "displayName": "全媒体爬虫引擎",
  "version": "1.0.0",
  "type": "headless",
  "main": "index.js"
}
```

代码逻辑 `plugins/quanmedia-crawl/index.js`：

```javascript
module.exports = {
  apply(ctx) {
    // 直接挂载服务
    ctx.registerService("crawlerService", {
      async fetchAccountData(platform, accountId) {
        // 爬虫业务代码...
        return { platform, accountId, followers: 10000 };
      }
    });

    // 监听全局事件
    ctx.on("trigger-all-spiders", () => {
      ctx.logger.info("收到全局广播，开始批量执行爬虫任务...");
    });
  }
};
```

### 五、方案落地总结与优势

1. 绝对主权与完全独立：零外部依赖（无需 Cordis 等大包），纯 TypeScript + Node.js 原生逻辑，属于你自己的资产。
2. 零端口冲突与内存隔离：基于 `app-plugin://` 自定义协议与 `ServiceRegistry`，告别端口争抢；界面之间采用 `<webview>` 隔离，某个子项目崩溃不会导致主程序挂掉。
3. 极简极速扩展：
   - 每一个现有的 HTML First 项目，只需要在根目录贴一个 `plugin.manifest.json` 和 `index.js` 导出 `apply` 钩子。
   - 把整个文件夹扔进 `plugins/` 目录，宿主瞬间扫描识别，无需重新打包编译主程序。

关于新插件的开发和安装分发，同样需要一套「开发时解耦，运行时标准化」的工业级流程。可以直接参考现代 IDE（如 VS Code、Cursor）或工具软件的插件机制。

### 六、开发阶段：新插件怎么放

在本地开发时，绝对不要每次修改代码都去复制粘贴到 Hub 的 `plugins/` 目录。

#### 最佳做法：软链接（Symlink）或绝对路径挂载

1. 工作区保持现状。新插件（如 `0007-新项目`）依然放在 `Web Coding` 目录里，独自进行 Git 版本控制。
2. 开发模式让 Hub 自动识别。在 `src/main/registry.ts` 中支持配置多个扫描目录，或者在开发环境自动建立软链接。

方式 1：多目录扫描（最推荐，零命令）。在 Hub 的配置或开发环境变量中，让 Hub 直接扫描工作区根目录：

```typescript
// src/main/registry.ts
const devWorkspace = '/Users/yourname/Web Coding';
await registry.scanAndLoadPlugins(devWorkspace);
```

只要新项目的根目录下有 `plugin.manifest.json`，Hub 启动时就会自动识别并加载它，完全不需要移动或拷贝任何文件夹。

方式 2：软链接（Symbolic Link / `pnpm link`）。如果只想加载特定项目，在终端执行一条软链接命令，把新项目链到 Hub 的 `plugins/` 目录下：

```bash
# Mac/Linux
ln -s "/Users/.../Web Coding/0007-新项目" "./hub-app/plugins/0007-新项目"

# Windows (CMD 管理员权限)
mklink /D ".\hub-app\plugins\0007-新项目" "D:\Web Coding\0007-新项目"
```

效果：在源码里修改任何一行代码，Hub 刷新后立刻生效，完全不需要任何拷贝。

另一种写法是 Hub 增加本地项目挂载配置 `hub-app/config.dev.json`：

```json
{
  "extraPluginPaths": [
    "/Users/yourname/Web Coding/0007-新AI工具",
    "/Users/yourname/Web Coding/0008-智能营销助手"
  ]
}
```

Hub 启动时不仅扫描自身的 `plugins/` 目录，还顺便去扫描这些外部配置路径，实现零侵入无缝开发。

使用 pnpm / npm 软链接时，假设工作区目录结构如下：

```text
Web Coding/
├── hub-app/                  # Hub 宿主项目
└── 0007-新AI工具/             # 正在开发的新插件
```

```bash
# Mac / Linux
ln -s "/绝对路径/Web Coding/0007-新AI工具" "/绝对路径/Web Coding/hub-app/plugins/0007-新AI工具"

# Windows (CMD 管理员权限)
mklink /D "C:\绝对路径\hub-app\plugins\0007-新AI工具" "C:\绝对路径\0007-新AI工具"
```

### 七、发布与安装阶段

把某个插件单独发给客户或同事时，用户不可能去配置路径或写命令行。

#### 1. 插件打包规范（导出 `.zip` 或 `.hplugin` 专属包）

包含内容：

- `plugin.manifest.json`
- `index.js`（或 PyInstaller 编译好的二进制，例如 `bin/listener_cli`）
- `ui/` 静态界面
- 必须的静态资源（`assets/`、`prompts/` 等）

排除内容（通过 `.gitignore` 或打包脚本排除）：

- `.venv/`（Python 虚拟环境）
- `.git/`、`.cursor/`
- 临时缓存（`cache/`、`output/` 中的临时生成文件）

产物示例：`english-listening-master-v1.0.0.zip`（后缀也可以改成自定义格式，如 `.hpk` / `.hpkg`）。

#### 2. 方案 A：Hub 界面一键安装 / 拖拽安装

在 Hub 宿主的前端界面上，加一个「添加 / 安装插件」按钮或拖拽区域：

1. 拖拽上传：用户把 zip 拖进 Hub 界面。
2. 静默解压：Hub 的主进程接收到 ZIP 文件后，在本地 `userData/installed_plugins/` 目录中解压该文件，读取其 `plugin.manifest.json`，调用 `registry.loadPlugin()` 无缝热挂载。
3. 即刻呈现：侧边栏瞬间刷新出新应用，用户点击即可使用，无需重启客户端。

主进程解压核心逻辑示例（`adm-zip`）：

```typescript
import admZip from 'adm-zip';
import { ipcMain } from 'electron';

ipcMain.handle('install-plugin-zip', async (event, zipFilePath) => {
  const pluginsInstallDir = path.join(app.getPath('userData'), 'installed_plugins');

  const zip = new admZip(zipFilePath);
  zip.extractAllTo(pluginsInstallDir, true);

  await registry.scanAndLoadPlugins(pluginsInstallDir);

  return { success: true, pluginList: registry.getPluginList() };
});
```

等价示例（`unzipper`）：

```javascript
const unzipper = require('unzipper');
const fs = require('fs');
const path = require('path');

ipcMain.handle('install-plugin-zip', async (event, zipFilePath) => {
  const userPluginsDir = path.join(app.getPath('userData'), 'installed_plugins');

  if (!fs.existsSync(userPluginsDir)) {
    fs.mkdirSync(userPluginsDir, { recursive: true });
  }

  await fs.createReadStream(zipFilePath)
    .pipe(unzipper.Extract({ path: userPluginsDir }))
    .promise();

  await registry.scanAndLoadPlugins(userPluginsDir);

  return { success: true, message: '插件安装成功！' };
});
```

安装流程：

1. 打包插件：将子项目根目录（包含 `plugin.manifest.json`、`index.js`、`ui/`，排除 `.venv` 或 `node_modules`）压缩成 zip 发给用户。
2. 用户操作：打开 Hub，把 zip 拖入界面，或点击「安装新插件」并选择该 ZIP 文件。
3. Hub 后台处理：自动解压到用户电脑的本地存储目录（如 Mac 的 `~/Library/Application Support/HuyuanHub/plugins/`），自动校验 `plugin.manifest.json`，校验通过后重新加载，侧边栏无需重启立即出现新应用。

#### 3. 方案 B：在线插件市场 / 一键下载安装（SaaS 商业化扩展）

产品发展到商业化阶段时：

1. Hub 客户端请求服务器 API：`GET https://api.yourdomain.com/v1/plugins`（返回所有可用插件列表及下载链接）。
2. 用户在 Hub 内的「插件商店」页面点击安装。
3. Hub 自动将 ZIP 下载到本地，完成解压并渲染。

线上索引示例：

```json
[
  {
    "id": "english-master",
    "name": "英语听力大师",
    "version": "1.0.2",
    "downloadUrl": "https://cdn.yourdomain.com/plugins/english-master-v1.0.2.zip"
  }
]
```

Hub 内置一个「插件市场」页，拉取线上接口渲染成卡片阵列，每个卡片旁有安装 / 更新按钮。用户点击安装后，Hub 用 Node.js 下载 ZIP，解压至本地，触发 `registry.loadPlugin()`，侧边栏实时渲染出新图标。

### 八、总结落地建议

1. 自己开发时：在本地 `plugins/` 目录下建软链接连到现有子项目，改完即生效，不搬运文件。也可以用 `config.dev.json` 的 `extraPluginPaths` 挂绝对路径。
2. 发布给别人时：将子项目剔除无关文件后打成 zip；在 Hub 界面做拖拽区域，实现「拖入 ZIP → 后台自动解压至 `userData` 目录 → 动态渲染图标」。
3. 在线插件市场留到商业化阶段，不作为当前版本的交付范围。
