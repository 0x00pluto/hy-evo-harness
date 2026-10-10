# 发布插件到插件中心

把一个插件仓库的某个 tag 打成源码 zip，上传到七牛，并合成 Dex Buddy 读取的插件目录。同事在插件页的「插件中心」里安装和更新，不收下载地址。技能中心不参与。

插件作者要做的事见 [发到插件中心](../plugin-development/distribute.md)。本篇只说明维护者如何在本仓触发。七牛密钥只放在本仓的 Actions secrets 里。

仓库根如果还有 `dex-buddy-plugin-pack.json`，工作流会直接失败。插件不再在三端编译二进制。需要解释器的插件在清单里声明 `runtime`，由同事机器上的 Dex Buddy 安装依赖。

## 入口

GitHub 仓库 `0x00pluto/hy-evo-harness` → Actions → Publish Plugin → Run workflow。

工作流文件：[`.github/workflows/publish-plugin.yml`](../../.github/workflows/publish-plugin.yml)。

## 参数

| 参数 | 说明 |
|---|---|
| repository | 插件仓库，`owner/name`。也可以填 `https://github.com/owner/name` |
| tag | `vX.Y.Z`。去掉 `v` 之后必须等于该仓库 `plugin.manifest.json` 的 `version` |

私有插件仓库读不到时，在本仓添加 secret `PLUGIN_CHECKOUT_TOKEN`（能读该仓库的令牌）。公开仓库不用。

七牛沿用应用发版的 `QINIU_ACCESS_KEY`、`QINIU_SECRET_KEY`、`QINIU_BUCKET`。

## 日常步骤

1. 在插件仓库把 `plugin.manifest.json` 的 `version` 改成新的 `X.Y.Z` 并推送。
2. 打上 tag `vX.Y.Z` 并推送。
3. 在本仓手动运行 Publish Plugin，填入仓库和这个 tag。
4. 工作流只上传 `dex-buddy/plugins/<id>/<version>.zip` 和同名的 `.json`，再根据桶里全部版本说明合成 `dex-buddy/plugins/index.json`。每个 id 只保留最高的 `X.Y.Z`。合成任务串行，避免两次发布互相漏记。
5. 同事打开 Dex Buddy 插件页，点「插件中心」，再点安装。已从插件中心安装过的插件，目录里有更高版本时，列表显示「可更新」，详情里点「更新」。

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
| 同事看不到新版本 | 看工作流是否把 `index.json` 刷到 CDN。插件页点插件中心的刷新 |

## 测试

```bash
pnpm test
```

覆盖版本比较、目录地址、打包排除、来源记录和「只有插件中心安装过的才提示更新」。

## 以后改成推 tag 自动发布

GitHub 的 reusable workflow 允许插件仓库用 `uses` 调用本仓这份工作流。被调用时拿不到本仓的仓库密钥，个人账号 `0x00pluto` 也还没有组织密钥。因此现在不要把下面这段放进插件仓库，也不要把七牛密钥抄进去。

组织密钥就绪、并允许这些插件仓库使用之后，插件仓库再加 `.github/workflows/publish-plugin.yml`：

```yaml
name: Publish plugin
on:
  push:
    tags:
      - "v*"
jobs:
  publish:
    uses: 0x00pluto/hy-evo-harness/.github/workflows/publish-plugin.yml@main
    with:
      repository: ${{ github.repository }}
      tag: ${{ github.ref_name }}
    secrets: inherit
```

`secrets: inherit` 传的是插件仓库当时能用的密钥。七牛密钥必须是组织密钥，不能只存在本仓。
