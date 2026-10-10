# 打包时带上哪些文件

[返回目录](README.md)

发到插件中心时，Dex Buddy 从这次 tag 的检出里打 zip。作者不用再维护第二份二进制打包清单。同事拖进工作台的 zip 是作者自己打的，Dex Buddy 安装时不会再读下面这两份文件。

## 宿主始终丢掉

这些路径写进包含清单也不会进包：

- 目录名是 `.git`、`.venv`、`node_modules`、`cache`、`output`、`temp`、`.cursor`、`bin`、`.next` 的，整段丢掉。源码目录如果正好叫 `bin` 或 `output`，也不会进包。
- `.env`，以及 `.env.local` 这类 `.env.` 开头的文件。`.env.example` 保留。
- `.DS_Store`、`__pycache__` 目录，以及以 `.pyc` 结尾的文件。

不能用 `!` 把它们加回来。名叫 `output` 或 `bin` 的源码目录也进不了包。把源码放到别的目录名，例如 `src/`。

## 先后

一个文件要连过这三关才进包。同一条路径撞在一起时，按这个顺序判：

1. 有 `dex-buddy-plugin.pack` 时，路径必须匹配其中一行。没有这份文件，这一关当全部通过。`tests/` 没写进去就不会进包。
2. 有 `dex-buddy-plugin.ignore` 时，匹配到的路径拿掉。同一路径两份文件都写了，排除赢。pack 里有 `src/`、ignore 里有 `src/drafts/` 时，`src/drafts/` 不进包。
3. 宿主默认排除最后生效。`.env`、`node_modules/`、`__pycache__/`、`.pyc`，以及名叫 `bin` 或 `output` 的目录，即使写在 pack 里也不进包。没有 `!` 可以把它们加回来。

## 作者指定范围

两份文件都放在插件根，都可选，写法相同。

`dex-buddy-plugin.pack` 写出要装给同事的路径。文件不存在时，候选是 tag 里的全部文件。文件存在但只有空行和注释时，候选是空的，打包失败，不会退回整份 tag。

`dex-buddy-plugin.ignore` 从候选里再挖掉路径。没有它时，不额外挖。

这两份文件在打 zip 之前就从检出里读，不必把自己写进包含清单才会生效。不写进去，它们不会出现在同事的安装包里。

```text
# dex-buddy-plugin.pack
plugin.manifest.json
index.js
requirements.txt
src/
ui/
```

```text
# dex-buddy-plugin.ignore
src/drafts/
src/*.local.json
```

上面这样，`src/app.py` 会进包，`src/drafts/` 和 `src/notes.local.json` 不会。`tests/` 没写在 pack 里，也不会进包。

规则：

- 路径相对插件根，用 `/`。空行和 `#` 开头的行忽略。
- 以 `/` 结尾表示这个目录和里面的全部文件，例如 `src/`、`src/drafts/`。`src` 没有结尾斜杠时，只匹配名叫 `src` 的那一个文件，目录里的源码不会进包。
- 不含 `*` 的一行是精确相对路径，例如 `index.js`。
- `*` 只匹配一层里的文件名，例如 `src/*.local.json`、`ui/*.html`。不支持 `**`，写了会让这次打包失败。
- 以 `!` 开头、绝对路径或含 `..` 的行会让这次打包失败。要留下的路径写在 pack 里，不要写 `!`。
- 文件在，但某一行不合法，打包失败，不会退回去把整个仓库都打进去。
- 结果里没有 `plugin.manifest.json` 时，打包失败。清单里写了 `main`、`uiEntry`、`runtime.python.requirements` 或 `runtime.node.package` 时，对应文件也不在结果里，同样失败。

两份都没有时，不该装给同事的文件就不要提交进 tag。密钥继续放在 Dex Buddy 的设置页，不要写进仓库。

这不是 `dex-buddy-plugin-pack.json`。仓库根上还有那份文件时，发布会失败。

## 两种安装包

插件中心的 zip 由 Dex Buddy 从 tag 检出里打，会读 `dex-buddy-plugin.pack` 和 `dex-buddy-plugin.ignore`。拖进工作台的 zip 是作者自己打的，安装时不读这两份文件。同一个仓库，两种装法同事拿到的文件可以不同：插件中心可以是瘦包，自己打的 zip 仍可以是整仓。
