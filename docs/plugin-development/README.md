# 给 Dex Buddy 写插件

这份说明可以单独转发。按下面做，Dex Buddy 启动后就能在侧边栏看到你的插件。插件不需要自己监听端口，也不需要知道 Electron 怎么启动。

Dex Buddy 负责三件事：扫描你的目录、运行你的 `index.js`、如果有界面就打开你的 HTML。

## 你要交出来的东西

一个目录，根上有 `plugin.manifest.json`。

```text
my-tool/
├── plugin.manifest.json
├── icon.png          # 可选。列表和详情用同一张
├── index.js          # 后端。没有后端逻辑可以不放
└── ui/
    └── index.html    # 只有带界面的插件需要
```

两种插件：

| type | 侧边栏点开之后 | 必须有的文件 |
|---|---|---|
| `ui` | 右侧打开你的 HTML | `uiEntry` 指向的页面。通常还有 `index.js` |
| `headless` | 主区域说明它已在后台运行 | `index.js` |

`index.js` 在 Dex Buddy 主进程里按 CommonJS 执行。这里可以用 Node，例如 `fs`、`child_process`，也可以拉起本机脚本。页面跑在隔离窗口里，没有 Node，不能 `require`，只能调用 `window.dex.call`。页面不要自己调命令行，见 [运行](runtime.md)。

## 往下读

- [清单](manifest.md)：`plugin.manifest.json` 的字段，以及图标尺寸。
- [设置](settings.md)：`configSchema`、分组、密钥和 `pluginEnv()`。
- [运行](runtime.md)：`index.js`、页面里的 `dex.call`，以及带界面、无界面两个例子。
- [发布](ship.md)：开发时挂到 Dex Buddy、打成 zip、什么情况会加载失败。
- [配色](color.md)：页面建议色。可以用，也可以自定。
