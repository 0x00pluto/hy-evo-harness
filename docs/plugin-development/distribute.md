# 发到插件中心

[返回目录](README.md)

作者只推 tag。发布用的插件 zip 由 Dex Buddy 仓库的 GitHub Action 从源码打出来并上传。作者不打这份额外的 zip，不上传七牛，也不在插件仓库里添加调用 Dex Buddy 的工作流。

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

4. 仓库第一次发布时，把仓库名（`owner/name`）告诉 Dex Buddy 维护者，由维护者写进授权名单。之后每次只推 tag，不用再通知。同步大约每小时一次；维护者也可以立刻同步。

只有页面和 `index.js`、不需要额外解释器的插件，做到这里就结束。

需要 Python 或自己的 Node 依赖时，在 `plugin.manifest.json` 写 `runtime`。Python 提交 `requirements.txt`。有 uv 工程时再在仓库根提交 `uv.lock`，没有锁也能发布。Node 必须提交和 `package.json` 同目录的 `package-lock.json`。装依赖的规则见 [运行](runtime.md)。不要再放 `dex-buddy-plugin-pack.json`。发布时如果仓库根上还有这份文件，这次发布会失败。

发布 zip 是这次 tag 检出里、排除项之外的全部文件，不只是源码。`tests/`、`docs/` 和大资源会进同事的包。排除 `.git`、`.venv`、`node_modules`、`cache/`、`output/`、`temp/`、`.cursor/`、`bin/`、`.next/`，以及 `.env`（保留 `.env.example`）。不要把密钥和大文件提交进 tag。同事安装之后，Dex Buddy 在那台机器上准备环境。

密钥继续放在 Dex Buddy 的设置页，不要写进仓库，不要打进包。

## 现在先不要做

- 不要在插件仓库添加 `.github/workflows` 去调用 Dex Buddy。
- 不要把七牛密钥放进插件仓库。
- 不要把编好的二进制提交进 git。

维护者如何在本仓点一次发布，见 [发布插件](../workflows/publish-plugin.md)。
