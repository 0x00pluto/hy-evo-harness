# 清单

[返回目录](README.md)

`plugin.manifest.json` 放在插件根目录，文件名固定。

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

- `id`：小写字母、数字、连字符，以字母或数字开头，最长 64 个字符。例如 `my-tool`。不要用中文、下划线或大写。官方新插件建议用 `app-dexbuddy-` 开头，例如 `app-dexbuddy-xiaohongshu`。这只是命名，宿主不会因为前缀拒载。已有的短 id 继续有效。调用模型时宿主用这里的值盖请求头，见 [模型](models.md)。
- `displayName`：侧边栏上的名字，不能为空。
- `version`：不能为空。发布用的 tag 必须是 `vX.Y.Z`。三位都是 `0`，或不带前导 0 的整数。去掉 `v` 之后必须和这里相同。建议写成 `1.0.0`。写成 `1.0` 或 `01.2.0` 时，本地仍能加载，同步到插件中心时才会失败。
- `type`：只能是 `ui` 或 `headless`。
- `main`：后端入口，相对插件根目录。没有后端就不要写这个字段。
- `uiEntry`：页面入口，相对插件根目录。`type` 为 `ui` 时必填。
- `configSchema`：可选。设置页要生成的字段，见 [设置](settings.md)。没有声明就不要写空对象。
- `settingsEntry`：可选。插件自己的设置页，相对插件根目录。见 [设置](settings.md)。
- `description`：可选。详情里的简介，去掉首尾空白后 1–280 个字符。
- `icon`：可选。插件目录内的一张图，列表、市场和详情共用。格式、尺寸和画面见下面「图标」。没写、文件不存在或图片打不开时，这几处都用默认拼图。发布时如果文件还在，版本说明会带上对应的 `iconUrl`。
- `developer`：可选。1–64 个字符。
- `category`：可选。1–32 个字符。详情展示这一行，插件市场用同一字符串分段；没写时归入「其他」。
- `website`、`privacyPolicy`、`termsOfService`：可选。带主机名的 `http` 或 `https`，最长 300 个字符。工作台用系统浏览器打开。
- `externalTools`：可选。本机命令，见下面「外部命令」。不写就不要写空数组。

这些目录字段全部可以不写。没写、或去掉空白后是空字符串，就当作没有。写错了插件仍然加载，详情不显示该字段，并给出一段说明。它们不进 `getPluginConfig()`，也不进 `pluginEnv()`。插件目录由工作台显示在名称旁的文件夹上，不用写进 manifest。

`main`、`uiEntry`、`settingsEntry` 和 `icon` 必须落在插件目录里面。不要写绝对路径，也不要写 `../`。`main`、`uiEntry`、`settingsEntry` 写错会导致加载失败；`icon` 写错只改用默认拼图。

页面里的 CSS、图片、脚本用相对路径即可。Dex Buddy 会按 `uiEntry` 所在位置去找它们。

## 外部命令

插件要调用 FFmpeg、agent-browser 这类本机命令时，在 `externalTools` 里按顺序声明。Dex Buddy 打开插件前只检查 PATH：都在才执行 `apply`。缺了就把还缺的命令合成一份编号说明，同事复制给 Codex 或 Workbuddy，由助手在这台电脑上装好。没写这个字段时，行为与现在一样：命令靠同事自己装在 PATH 里，没装时要等到调用才失败。

宿主不下载、不调用 brew / winget / npm，也不执行安装脚本。清单里不要写 `archive`、`npm`、`brew`、`winget`、`setup`。

```json
{
  "externalTools": [
    {
      "bin": "agent-browser",
      "guide": {
        "darwin": "https://github.com/vercel-labs/agent-browser",
        "win32": "https://github.com/vercel-labs/agent-browser"
      }
    },
    {
      "bin": "ffmpeg",
      "extraBins": ["ffprobe"],
      "guide": "https://ffmpeg.org/download.html"
    }
  ]
}
```

- `bin`：必填。只能是字母、数字、点、下划线和连字符。Windows 上还会找 `bin.exe` 和 `bin.cmd`。
- `extraBins`：同一份里的附带命令，例如 `ffprobe`。缺任何一个都算整组未就绪。
- `guide`：可选。一个 http(s) 链接，或按 `darwin` / `win32` 分开。只写进那份可复制说明，不当成要打开的页面。宿主不请求页面正文。

写错时插件仍出现在列表里，不执行 `apply`。错误会指出是第几条、缺了什么。缺命令时详情会弹出说明，并留下「复制」。装好后点「重试」。

声明了 `runtime` 时，用 `ctx.runtime.env` 拉起子进程，命令的绝对路径在 `ctx.tools`。没有声明 `runtime` 时，用 `pluginEnv()`，里面的 PATH 已经带上这些目录。不要改 Dex Buddy 自己的环境变量。

## 图标

`icon` 是插件目录里的相对路径，例如 `"icon": "icon.png"`。扩展名只能是 `png`、`jpg`、`jpeg`、`webp`、`svg`。`jpg` 和 `jpeg` 没有透明通道。SVG 可以当图标。工作台不读根元素上的 `width`、`height`。没有正方形 `viewBox` 时，缩放到 20px、32px 和 56px 不可靠。

左侧 48px 图标轨是工作台自己的拼图和齿轮，不放插件图标。插件图标出现在三处，而且是同一张图，没有单独的列表图或详情图：

| 位置 | 显示框 |
|---|---|
| 首页应用列表、插件页左栏、设置页左栏 | 20×20 像素，圆角 6px |
| 插件市场卡片 | 32×32 像素，圆角 8px |
| 详情页眉 | 56×56 像素，圆角 14px |

显示框是正方形。图片按 cover 铺满，多出来的左右或上下会被裁掉，四角再被圆角切掉。文件本身不强制正方形；不是正方形时，边缘内容可能被切掉，所以请交正方形。

位图至少 128×128 像素，更稳妥是 256×256。详情最大显示 56px，256 能在两倍屏上仍然清楚。SVG 用正方形 `viewBox`，例如 `viewBox="0 0 56 56"`。`width` 和 `height` 可以留着，但要和 `viewBox` 同比例。没有 `viewBox` 时，缩进这三个框里会不可靠。

彩色、单色都可以，只准备这一张。重要图形离四边留出大约一成，避免圆角切掉笔画。不要在图里留一大圈透明边，否则缩到 20px 时图形会很小。透明像素后面是浅灰，不要假设深色底，也没有第二张深色图标。

工作台不检查文件大小。建议单张不超过 200KB。
