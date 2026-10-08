# 给 Huyuan Hub 写插件

这份说明可以单独转发。按下面做，Hub 启动后就能在侧边栏看到你的插件。插件不需要自己监听端口，也不需要知道 Electron 怎么启动。

Hub 负责三件事：扫描你的目录、运行你的 `index.js`、如果有界面就打开你的 HTML。

## 你要交出来的东西

一个目录，根上有 `plugin.manifest.json`。

```text
my-tool/
├── plugin.manifest.json
├── index.js          # 后端。没有后端逻辑可以不放
└── ui/
    └── index.html    # 只有带界面的插件需要
```

两种插件：

| type | 侧边栏点开之后 | 必须有的文件 |
|---|---|---|
| `ui` | 右侧打开你的 HTML | `uiEntry` 指向的页面。通常还有 `index.js` |
| `headless` | 主区域说明它已在后台运行 | `index.js` |

`index.js` 在 Hub 主进程里按 CommonJS 执行。这里可以用 Node，例如 `fs`、`child_process`，也可以拉起本机脚本。页面跑在隔离窗口里，没有 Node，不能 `require`，只能调用 `window.hub.call`。

## 页面不要调命令行

页面只收集输入、展示结果。按钮里调用 `window.hub.call`，把普通对象交给 `index.js`。拼命令行参数、`child_process`、Python、FFmpeg 都写在 `index.js` 的服务方法里。

逻辑本来就是 Node 函数时，在服务方法里直接调用。逻辑是 Python 或现成命令行时，在服务方法里拉起进程，把输出收成返回值。已有的命令行保持原样，继续由 `index.js` 调用。

```javascript
const { spawn } = require('child_process');

module.exports = {
  apply(ctx) {
    ctx.registerService('myToolService', {
      run(params) {
        const lesson = params && typeof params.lesson === 'string' ? params.lesson : '';
        return new Promise((resolve, reject) => {
          const child = spawn('python3', ['src/main.py', '--lesson', lesson], {
            cwd: __dirname,
          });
          let stdout = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
          });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(`命令退出码 ${code}`));
              return;
            }
            resolve({ success: true, output: stdout.trim() });
          });
        });
      },
    });
  },
};
```

页面这边仍然只有：

```javascript
const result = await window.hub.call('myToolService', 'run', [{ lesson: '6-upper' }]);
```

`window.hub.call` 是一次请求、一次返回。命令还在跑的时候，页面收不到中途进度。等命令结束，再返回 `{ success: true, outputPath: '/path/to/result.mp4' }` 这样的普通对象。

改布局时可以先用浏览器打开 HTML。放进 Hub 之后，按钮必须走 `window.hub.call`。

## plugin.manifest.json

放在插件根目录，文件名固定。

带界面：

```json
{
  "id": "my-tool",
  "displayName": "我的工具",
  "version": "1.0.0",
  "type": "ui",
  "main": "index.js",
  "uiEntry": "ui/index.html"
}
```

无界面：

```json
{
  "id": "my-crawler",
  "displayName": "我的爬虫",
  "version": "1.0.0",
  "type": "headless",
  "main": "index.js"
}
```

字段：

- `id`：小写字母、数字、连字符，以字母或数字开头，最长 64 个字符。例如 `my-tool`。不要用中文、下划线或大写。
- `displayName`：侧边栏上的名字，不能为空。
- `version`：不能为空。建议 `1.0.0` 这种写法。
- `type`：只能是 `ui` 或 `headless`。
- `main`：后端入口，相对插件根目录。没有后端就不要写这个字段。
- `uiEntry`：页面入口，相对插件根目录。`type` 为 `ui` 时必填。

`main` 和 `uiEntry` 必须落在插件目录里面。不要写绝对路径，也不要写 `../`。

页面里的 CSS、图片、脚本用相对路径即可。Hub 会按 `uiEntry` 所在位置去找它们。

## 后端 index.js

用 CommonJS 导出 `apply`。需要回收资源时再导出 `dispose`。

```javascript
module.exports = {
  apply(ctx) {
    ctx.registerService('myToolService', {
      async run(params) {
        const text = params && typeof params.text === 'string' ? params.text : '';
        ctx.logger.info(`收到请求: ${text}`);
        return { success: true, text };
      },
    });
  },

  dispose() {
    console.log('插件已卸载');
  },
};
```

`ctx` 上有这些方法：

- `registerService(name, service)`：把一组方法挂到 Hub。名字全局唯一，已经被别人注册过会拒绝。
- `getService(name)`：拿到别的插件注册的服务，在后端里直接调用。
- `logger.info(msg)` / `logger.error(msg)`：写到 Hub 日志。
- `emit(event, ...args)`：向所有插件广播。
- `on(event, handler)`：收广播。

卸载时 Hub 会调用 `dispose`，并摘掉这个插件注册的服务和 `on` 监听。不要把清理工作只留在 `dispose` 外面。

服务方法的参数和返回值必须是普通数据：对象、数组、字符串、数字、布尔值、`null`。不要返回函数、类实例、`Map`、`Set` 或带循环引用的对象。

## 页面里调用服务

```javascript
const result = await window.hub.call('myToolService', 'run', [{ text: '你好' }]);
```

- 第一个参数是 `registerService` 时的名字。
- 第二个参数是服务对象上的方法名。方法必须直接写在这个对象上，名字只能是字母、数字和下划线，并且以字母或下划线开头。
- 第三个参数是参数数组，对应方法的各个参数。没有参数就传 `[]`。

页面里不要写 `require('electron')`，也不要自己起 HTTP 服务。

## 示例：带界面

目录：

```text
my-tool/
├── plugin.manifest.json
├── index.js
└── ui/
    └── index.html
```

`plugin.manifest.json`：

```json
{
  "id": "my-tool",
  "displayName": "我的工具",
  "version": "1.0.0",
  "type": "ui",
  "main": "index.js",
  "uiEntry": "ui/index.html"
}
```

`index.js`：

```javascript
module.exports = {
  apply(ctx) {
    ctx.logger.info('我的工具已挂载');
    ctx.registerService('myToolService', {
      async run(params) {
        const text = params && typeof params.text === 'string' ? params.text : '';
        return { success: true, text };
      },
    });
  },

  dispose() {
    console.log('我的工具已卸载');
  },
};
```

`dispose` 没有 `ctx` 参数。需要停掉的定时器、子进程，在 `apply` 里保存句柄，再到 `dispose` 里关掉。`dispose` 返回之后，Hub 会摘掉这个插件注册的服务和监听。

`ui/index.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>我的工具</title>
</head>
<body>
  <h1>我的工具</h1>
  <input id="text" value="你好" />
  <button id="btn" type="button">执行</button>
  <pre id="result">等待执行</pre>
  <script>
    const result = document.getElementById('result');
    document.getElementById('btn').onclick = async () => {
      const text = document.getElementById('text').value;
      result.textContent = '正在执行…';
      try {
        const payload = await window.hub.call('myToolService', 'run', [{ text }]);
        result.textContent = JSON.stringify(payload, null, 2);
      } catch (err) {
        result.textContent = err && err.message ? err.message : '执行失败';
      }
    };
  </script>
</body>
</html>
```

把 `id`、显示名、服务名换成你自己的。`window.hub.call` 的第一个参数必须和 `registerService` 的名字一致。

## 示例：无界面

目录：

```text
my-crawler/
├── plugin.manifest.json
└── index.js
```

`plugin.manifest.json`：

```json
{
  "id": "my-crawler",
  "displayName": "我的爬虫",
  "version": "1.0.0",
  "type": "headless",
  "main": "index.js"
}
```

`index.js`：

```javascript
module.exports = {
  apply(ctx) {
    ctx.registerService('myCrawlerService', {
      async fetchAccount(platform, accountId) {
        return { platform, accountId, followers: 10000 };
      },
    });

    ctx.on('trigger-all-spiders', () => {
      ctx.logger.info('收到广播，开始执行任务');
    });
  },
};
```

侧边栏里点它，不会打开页面。别的插件可以在后端用 `ctx.getService('myCrawlerService')` 调用它，也可以在自己的页面里 `window.hub.call('myCrawlerService', 'fetchAccount', ['douyin', '123'])`。

要让它开始工作，由某个插件或你自己的 `apply` 里执行：

```javascript
ctx.emit('trigger-all-spiders');
```

## 开发时挂到 Hub

不要把源码复制进 Hub 的 `plugins/` 目录，否则改一处、另一处还是旧的。任选一种：

软链接（Mac / Linux）：

```bash
ln -s "/绝对路径/my-tool" "/绝对路径/HuyuanHub/plugins/my-tool"
```

或者请 Hub 维护者在 Hub 仓库根目录复制 `config.dev.example.json` 为 `config.dev.json`，写上你的项目绝对路径：

```json
{
  "extraPluginPaths": [
    "/绝对路径/my-tool"
  ]
}
```

这条路径可以是插件根目录（里面直接有 `plugin.manifest.json`），也可以是一个文件夹，里面每个子目录是一个插件。`config.dev.json` 只在未打包的开发版里生效。

改完 `index.js` 或页面后，重启 Hub。同名 `id` 谁先被扫到就用谁，后扫到的会跳过。顺序是：Hub 仓库里的 `plugins/`、`config.dev.json`、用户后来安装的插件。

## 打成 zip 给别人安装

在插件目录的上一级打包，让压缩包里带上插件文件夹：

```bash
cd /绝对路径
zip -r my-tool-v1.0.0.zip my-tool \
  -x '*.DS_Store' \
  -x '*/.git/*' \
  -x '*/.venv/*' \
  -x '*/node_modules/*' \
  -x '*/cache/*' \
  -x '*/output/*' \
  -x '*/.cursor/*'
```

压缩包要满足其中一种：

- 解压后根上就是 `plugin.manifest.json`
- 解压后只有一层目录，这个目录里有 `plugin.manifest.json`

不要打进 `.git`、`.venv`、`node_modules`、`cache/`、`output/`。包里不要出现绝对路径或 `..`。

对方打开 Hub，把 zip 拖进欢迎页，或点击「安装插件」选这个文件。侧边栏会马上出现，不用重启。同一个已安装插件再次安装会覆盖。如果这个 `id` 已经来自 Hub 内置目录或开发路径，安装会被拒绝，需要换一个 `id`。

## 这样会加载失败

- `id` 含大写、中文、下划线，或超过 64 个字符。
- `type` 写成 `ui`，但没有 `uiEntry`。
- `main` 或 `uiEntry` 写成绝对路径，或路径里有 `..`。
- zip 里没有 `plugin.manifest.json`，或有多份、Hub 无法确定用哪一份。
- 服务方法返回了函数、类实例，或页面调用了一个不存在的方法。
- 服务名已经被别的插件注册过。
