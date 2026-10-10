# 发到插件中心

[返回目录](README.md)

作者只推 tag。发布用的插件 zip 由 Dex Buddy 仓库的 GitHub Action 生成并上传。作者不打这份额外的 zip，不上传七牛，不把二进制交进 git，也不在插件仓库里添加调用 Dex Buddy 的工作流。

同事从 Dex Buddy 的「插件中心」安装。不要把下载地址发给他们。

## 每个插件都要做

1. 开发时用自己的仓库。不要把源码复制进 Dex Buddy 的 `plugins/`。让 Dex Buddy 维护者把你的绝对路径写进他本机的 `config.dev.json`，改完 `index.js` 或页面后重启 Dex Buddy。
2. 发一版时，把 `plugin.manifest.json` 的 `version` 改成新的 `X.Y.Z`（三位数字，不要前导 0）。
3. 提交并推送，然后打 tag 并推送：

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

`v` 后面的数字必须和清单里的 `version` 相同。

4. 把仓库名（`owner/name`）和这个 tag 告诉 Dex Buddy 维护者。维护者在 Dex Buddy 仓库的 Actions 里运行 Publish Plugin。

只有页面和 `index.js`、不需要编译的插件，做到这里就结束。

## 需要编译的插件

安装包里不能带 `.venv`。需要二进制的插件在仓库根放 `dex-buddy.publish.json`：

```json
{
  "pack": "scripts/dex-buddy-pack.sh",
  "runners": ["macos-14", "windows-latest"]
}
```

`pack` 是仓库内的相对路径，不能是绝对路径，也不能包含 `..`。`runners` 只能从 `ubuntu-latest`、`macos-14`、`windows-latest` 里选，至少一台，不能重复。没有这份文件时，Action 直接把检出的源码打成 zip。

Action 在列出的每台机器上各执行一次该脚本，工作目录是仓库根。脚本自己准备编译环境，然后：

- 把要发给同事的文件放进 `bin/`。macOS 上例如 `bin/manju-studio-worker`，Windows 上例如 `bin/manju-studio-worker.exe`。
- 退出码不是 0 则这次发布失败。
- 不要上传，不要自己打给同事的 zip，不要把产物只留在 `temp/`。`temp/` 不会进最终的插件 zip。

各台机器上的 `bin/` 会合并进**同一份** zip：`dex-buddy/plugins/<id>/<version>.zip`。同名文件不能来自两台机器。同事无论用哪种系统，插件中心都安装这一个包。插件在运行时自己挑选本机的二进制。

以漫剧操作台为例：`runners` 用 `macos-14` 和 `windows-latest`。Mac 产物是 `bin/manju-studio-worker`，Windows 产物是 `bin/manju-studio-worker.exe`。`index.js` 在 Windows 上启动 `.exe`，在其他系统上启动没有后缀的那个文件。没有虚拟环境、两个二进制也都不存在时，仍报「安装包不完整」。本机拖放用的打包脚本可以保留，它不代替上面这份给 Action 调用的脚本。

密钥继续放在 Dex Buddy 的设置页，不要写进仓库，不要打进包。

## 这一期的平台

Apple Silicon Mac 用 `macos-14`，Windows x64 用 `windows-latest`。Intel Mac 和 Windows ARM 先不做。

## 现在先不要做

- 不要在插件仓库添加 `.github/workflows` 去调用 Dex Buddy。
- 不要把七牛密钥放进插件仓库。
- 不要把编好的二进制提交进 git。

维护者如何在本仓点一次发布，见 [发布插件](../workflows/publish-plugin.md)。
