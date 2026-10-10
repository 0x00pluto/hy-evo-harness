# 发布插件到插件中心

把一个插件仓库的某个 tag 打成源码 zip，上传到七牛，并合成 Dex Buddy 读取的插件目录。同事在插件页的「插件中心」里安装和更新，不收下载地址。技能中心不参与。

插件作者要做的事见 [发到插件中心](../plugin-development/distribute.md)。本篇只说明维护者如何在本仓触发。七牛密钥只放在本仓的 Actions secrets 里。

仓库根如果还有 `dex-buddy-plugin-pack.json`，工作流会直接失败。插件不再在三端编译二进制。需要解释器的插件在清单里声明 `runtime`，由同事机器上的 Dex Buddy 安装依赖。

## 日常：授权名单

把插件仓库的 `owner/name` 写进 [`.github/plugin-repos.json`](../../.github/plugin-repos.json)，推到 `main`。不在名单里的仓库不会被拉。七牛密钥仍然只在本仓的 Actions secrets 里。插件仓库不保存密钥，也不要添加调用本仓的工作流。

作者推送 `vX.Y.Z` 之后，同步工作流会看到它。推完不会立刻出现在插件中心，要等这一小时，或手动跑一次。

工作流文件：[`.github/workflows/sync-plugin-catalog.yml`](../../.github/workflows/sync-plugin-catalog.yml)。每小时第 17 分跑一次，也可以手动触发：

```bash
gh workflow run sync-plugin-catalog.yml --ref main
```

一次同步对名单里的每个仓库只取最高的 `vX.Y.Z`。更低的 tag 不补传。七牛上已有这个版本的 zip 就跳过。清单版本和 tag 不一致，或仓库根上还有 `dex-buddy-plugin-pack.json`，这个仓库记失败，继续处理后面的仓库。只要这次有新包，就按桶里全部版本说明重写 `index.json` 并刷新 CDN。有失败时工作流标红。

私有插件仓库读不到时，在本仓添加 secret `PLUGIN_CHECKOUT_TOKEN`（能读该仓库的令牌）。公开仓库不用。七牛沿用应用发版的 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`。

## 作者那边

1. 在插件仓库把 `plugin.manifest.json` 的 `version` 改成新的 `X.Y.Z` 并推送。
2. 打上 tag `vX.Y.Z` 并推送。`v` 后面的数字必须等于清单里的 `version`。
3. 仓库已经在授权名单里时，不用再把这一次 tag 告诉维护者。同步工作流会发布该仓库当前最高的 tag。

工作流只上传 `dex-buddy/plugins/<id>/<version>.zip` 和同名的 `.json`，再根据桶里全部版本说明合成 `dex-buddy/plugins/index.json`。每个 id 只保留最高的 `X.Y.Z`。同步任务串行，避免两次发布互相漏记。

同事打开 Dex Buddy 插件页，点「插件中心」，再点安装。已从插件中心安装过的插件，目录里有更高版本时，列表显示「可更新」，详情里点「更新」。

本地拖进工作台的 zip 会记成「文件」来源，不参与这项更新。内置和开发路径里的同 id 不能被插件中心覆盖。

## 产物

- `https://oss.ai.66plat.com/dex-buddy/plugins/<id>/<version>.zip`
- `https://oss.ai.66plat.com/dex-buddy/plugins/<id>/<version>.json`
- `https://oss.ai.66plat.com/dex-buddy/plugins/index.json`

版本说明里有 `id`、`displayName`、`version`、`description`、`downloadUrl`、`sha256`。工作台只从 `oss.ai.66plat.com` 下载，并核对 sha256。渲染进程不能传入下载地址。

## 失败排查

| 现象 | 处理 |
|---|---|
| 清单版本与 tag 不一致 | 改清单或改 tag，使 `v` 后面的数字与 `version` 相同 |
| 检出插件仓库失败 | 仓库不是 `owner/name`，或私有仓库未设置 `PLUGIN_CHECKOUT_TOKEN` |
| 插件包校验不一致 | 不要手改已上传的 zip。重新跑工作流，让目录里的 sha256 与包一致 |
| 同事看不到新版本 | 看同步工作流是否跑完，以及是否把 `index.json` 刷到 CDN。推 tag 后最多等一小时，或手动跑同步。插件页点插件中心的刷新 |
| 仓库没有出现在同步里 | 把 `owner/name` 写进 `.github/plugin-repos.json` 并推到 `main` |

## 测试

```bash
pnpm test
```

覆盖版本比较、授权名单、最高 tag、一个仓库失败时其余仓库仍发布、打包排除、来源记录和「只有插件中心安装过的才提示更新」。

不要在插件仓库加工作流去调用本仓。七牛密钥只放在本仓。
