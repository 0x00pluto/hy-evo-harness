# 运行

[返回目录](README.md)

## 页面不要调命令行

页面只收集输入、展示结果。按钮里调用 `window.dex.call`，把普通对象交给 `index.js`。拼命令行参数、`child_process`、Python、FFmpeg 都写在 `index.js` 的服务方法里。

逻辑本来就是 Node 函数时，在服务方法里直接调用。这用的是 Electron 自带的 Node，没有 npm。逻辑是 Python，或插件自己带 `package.json` 的 Node 服务时，在服务方法里用 `ctx.runtime` 拉起进程，把输出收成返回值。页面继续只调 `window.dex.call`，不要把 Next.js 或 FastAPI 的页面嵌进工作台。

清单里声明了 `runtime` 之后，Dex Buddy 才准备解释器。没有声明的插件不下载。解释器版本写在宿主里，清单不写 `3.12` 或 `22`。Python 全机一份。官方 Node 也是全机一份，只用来跑插件自己的服务；`index.js` 仍跑在 Electron 里。

```json
{
  "runtime": {
    "python": { "requirements": "requirements.txt" },
    "node": { "package": "package.json" }
  }
}
```

Python 有 `uv.lock` 时按锁文件装，否则用 `requirements.txt`。Node 需要同目录的 `package-lock.json`。同事第一次打开会下载解释器并安装依赖，插件页显示「正在准备运行环境」。失败时详情里留下日志，可以重试。

```javascript
const { spawn } = require('child_process');

module.exports = {
  apply(ctx) {
    ctx.registerService('myToolService', {
      run(params) {
        const lesson = params && typeof params.lesson === 'string' ? params.lesson : '';
        return new Promise((resolve, reject) => {
          const child = spawn(ctx.runtime.python, ['src/main.py', '--lesson', lesson], {
            cwd: __dirname,
            env: ctx.runtime.env,
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

FastAPI 或 Next.js 同样在 `apply` 里启动，在 `dispose` 里关掉。宿主不识别具体框架，也不监管端口。构建结果写到 `ctx.dirs.cache`，不要写进安装目录或 `ctx.dirs.data`。

没有第三方依赖的单个 `.js` 脚本可以用 Electron 加 `ELECTRON_RUN_AS_NODE=1` 拉起，不必声明 Node 运行时。

解释器放在七牛 `dex-buddy/runtimes/`，版本常量在 `src/main/plugin-runtime.ts`。包索引可以用环境变量 `DEX_BUDDY_PYPI_INDEX` 和 `DEX_BUDDY_NPM_REGISTRY` 改掉，默认是国内镜像。

页面这边仍然只有：

```javascript
const result = await window.dex.call('myToolService', 'run', [{ lesson: '6-upper' }]);
```

`window.dex.call` 是一次请求、一次返回。命令还在跑的时候，页面收不到中途进度。等命令结束，再返回 `{ success: true, outputPath: '/path/to/result.mp4' }` 这样的普通对象。

改布局时可以先用浏览器打开 HTML。放进 Dex Buddy 之后，按钮必须走 `window.dex.call`。

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

- `registerService(name, service)`：把一组方法挂到 Dex Buddy。名字全局唯一，已经被别人注册过会拒绝。
- `getService(name)`：拿到别的插件注册的服务，在后端里直接调用。
- `logger.info(msg)` / `logger.error(msg)`：写到 Dex Buddy 日志。
- `emit(event, ...args)`：向所有插件广播。
- `on(event, handler)`：收广播。
- `getPluginConfig()`：当前插件的配置。只含本插件声明过的键，不接收插件 id。声明方式见 [设置](settings.md)。
- `pluginEnv()`：给子进程用的环境变量。先复制 Dex Buddy 的环境，再盖上本插件的配置。数字变成十进制字符串，布尔变成 `true` 或 `false`。不会改 Dex Buddy 自己的 `process.env`。

开发时缓存、导出和数据库写在插件仓库里。装进 Dex Buddy 之后的落盘见 [数据](data.md)。`ctx.dirs.cache` 是可重建缓存，`ctx.dirs.data` 是卸载后仍保留的导出和数据库。

卸载时 Dex Buddy 会调用 `dispose`，并摘掉这个插件注册的服务和 `on` 监听。不要把清理工作只留在 `dispose` 外面。

服务方法的参数和返回值必须是普通数据：对象、数组、字符串、数字、布尔值、`null`。不要返回函数、类实例、`Map`、`Set` 或带循环引用的对象。

拉起声明过的 Python 或 Node 服务时，用 `ctx.runtime.env`。它在 `pluginEnv()` 上补了虚拟环境和 `PATH`。脚本里继续用 `os.getenv`：

```javascript
const { execFile } = require('node:child_process');

execFile(ctx.runtime.python, args, { env: ctx.runtime.env }, (err, stdout) => {
  // stdout 是命令结束后的输出
});
```

## 页面里调用服务

```javascript
const result = await window.dex.call('myToolService', 'run', [{ text: '你好' }]);
```

- 第一个参数是 `registerService` 时的名字。
- 第二个参数是服务对象上的方法名。方法必须直接写在这个对象上，名字只能是字母、数字和下划线，并且以字母或下划线开头。
- 第三个参数是参数数组，对应方法的各个参数。没有参数就传 `[]`。

页面里不要写 `require('electron')`，也不要自己起 HTTP 服务。

## 示例：带界面

页面配色见 [配色](color.md)。可以用那里的建议色，也可以自定。

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

`dispose` 没有 `ctx` 参数。需要停掉的定时器、子进程，在 `apply` 里保存句柄，再到 `dispose` 里关掉。`dispose` 返回之后，Dex Buddy 会摘掉这个插件注册的服务和监听。

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
        const payload = await window.dex.call('myToolService', 'run', [{ text }]);
        result.textContent = JSON.stringify(payload, null, 2);
      } catch (err) {
        result.textContent = err && err.message ? err.message : '执行失败';
      }
    };
  </script>
</body>
</html>
```

把 `id`、显示名、服务名换成你自己的。`window.dex.call` 的第一个参数必须和 `registerService` 的名字一致。

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

侧边栏里点它，不会打开页面。别的插件可以在后端用 `ctx.getService('myCrawlerService')` 调用它，也可以在自己的页面里 `window.dex.call('myCrawlerService', 'fetchAccount', ['douyin', '123'])`。

要让它开始工作，由某个插件或你自己的 `apply` 里执行：

```javascript
ctx.emit('trigger-all-spiders');
```
