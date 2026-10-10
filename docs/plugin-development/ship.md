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

同事拖进工作台的 zip 由作者自己打。压缩包要满足其中一种：

- 解压后根上就是 `plugin.manifest.json`
- 解压后只有一层目录，这个目录里有 `plugin.manifest.json`

不要打进密钥、虚拟环境和依赖目录。包里不要出现绝对路径或 `..`。拖进工作台的 zip 和插件中心的差别见 [打包](pack.md) 里的「两种安装包」。安装之后不要把缓存、导出和数据库写回安装目录，见 [数据](data.md)。

对方打开 Dex Buddy，把 zip 拖进欢迎页，或从图标轨的拼图进入插件页，点「添加」选这个文件。列表会马上出现，不用重启。同一个已安装插件再次安装会覆盖。如果这个 `id` 已经来自 Dex Buddy 内置目录或开发路径，安装会被拒绝，需要换一个 `id`。

## 发到插件中心

同事不收下载地址。作者改版本、推 tag。需要 Python 或 Node 依赖时在清单里声明 `runtime`，不要再交打包脚本。步骤见 [发到插件中心](distribute.md)。

维护者把仓库写进授权名单后，由 Dex Buddy 仓库的同步工作流发布。密钥和触发方式见 [发布插件](../workflows/publish-plugin.md)。

核心是 Python 或自带依赖的 Node 服务时，在 `plugin.manifest.json` 里声明 `runtime`。开发阶段可以继续用仓库里的 `.venv` 或 `node_modules`。装到别人机器上之后，Dex Buddy 用自己准备的解释器安装依赖，页面仍然只调用 `window.dex.call`。见 [运行](runtime.md)。

## 这样会加载失败

- `id` 含大写、中文、下划线，或超过 64 个字符。
- `type` 写成 `ui`，但没有 `uiEntry`。
- `main`、`uiEntry` 或 `settingsEntry` 写成绝对路径，或路径里有 `..`。
- zip 里没有 `plugin.manifest.json`，或有多份、Dex Buddy 无法确定用哪一份。
- 服务方法返回了函数、类实例，或页面调用了一个不存在的方法。
- 服务名已经被别的插件注册过。
