# 发布

[返回目录](README.md)

## 开发时挂到 Dex Buddy

不要把源码复制进 Dex Buddy 的 `plugins/` 目录，否则改一处、另一处还是旧的。任选一种：

软链接（Mac / Linux）：

```bash
ln -s "/绝对路径/my-tool" "/绝对路径/DexBuddy/plugins/my-tool"
```

或者请 Dex Buddy 维护者在 Dex Buddy 仓库根目录复制 `config.dev.example.json` 为 `config.dev.json`，写上你的项目绝对路径：

```json
{
  "extraPluginPaths": [
    "/绝对路径/my-tool"
  ]
}
```

这条路径可以是插件根目录（里面直接有 `plugin.manifest.json`），也可以是一个文件夹，里面每个子目录是一个插件。`config.dev.json` 只在未打包的开发版里生效。

改完 `index.js` 或页面后，重启 Dex Buddy。同名 `id` 谁先被扫到就用谁，后扫到的会跳过。顺序是：Dex Buddy 仓库里的 `plugins/`、`config.dev.json`、用户后来安装的插件。

## 打成 zip 给别人安装

在插件目录的上一级打包，让压缩包里带上插件文件夹：

```bash
cd /绝对路径
zip -r my-tool-v1.0.0.zip my-tool \
  -x '*.DS_Store' \
  -x '*/.git/*' \
  -x '*/.env' \
  -x '*/.venv/*' \
  -x '*/node_modules/*' \
  -x '*/cache/*' \
  -x '*/output/*' \
  -x '*/.cursor/*'
```

压缩包要满足其中一种：

- 解压后根上就是 `plugin.manifest.json`
- 解压后只有一层目录，这个目录里有 `plugin.manifest.json`

不要打进 `.git`、`.env`、`.venv`、`node_modules`、`cache/`、`output/`。包里不要出现绝对路径或 `..`。

对方打开 Dex Buddy，把 zip 拖进欢迎页，或从图标轨的拼图进入插件页，点「添加」选这个文件。列表会马上出现，不用重启。同一个已安装插件再次安装会覆盖。如果这个 `id` 已经来自 Dex Buddy 内置目录或开发路径，安装会被拒绝，需要换一个 `id`。

## 发到插件中心

同事不收下载地址。发版在 Dex Buddy 仓库里手动跑一次「Publish Plugin」：填这个插件仓库的 `owner/name`，以及 tag `vX.Y.Z`。tag 去掉 `v` 之后必须等于清单里的 `version`。流程会打包、上传到七牛，并重新合成插件目录。同事在插件页打开「插件中心」，点安装。

打包排除与上面的 zip 相同，另外不带 `.env.local` 这类 `.env.*` 文件。`.env.example` 可以留在包里。密钥让同事在设置页自己填。

步骤、密钥和以后如何改成推 tag 自动发布，见 [发布插件](../workflows/publish-plugin.md)。

核心是 Python 时，[运行](runtime.md) 里示例的 `python3` 只适合你自己的开发机。开发阶段可以让 `index.js` 调用本机虚拟环境里的解释器，命令行脚本保持原样。

发给别人时，把脚本打成可执行文件，放进插件目录，`index.js` 用相对路径调用它。依赖跟着这个可执行文件走。`.venv` 不打进 zip。页面不用改，仍然只调用 `window.dex.call`。

## 这样会加载失败

- `id` 含大写、中文、下划线，或超过 64 个字符。
- `type` 写成 `ui`，但没有 `uiEntry`。
- `main`、`uiEntry` 或 `settingsEntry` 写成绝对路径，或路径里有 `..`。
- zip 里没有 `plugin.manifest.json`，或有多份、Dex Buddy 无法确定用哪一份。
- 服务方法返回了函数、类实例，或页面调用了一个不存在的方法。
- 服务名已经被别的插件注册过。
