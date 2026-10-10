# 数据

[返回目录](README.md)

开发时，缓存、导出和数据库写在插件仓库里。打成 zip 装进 Dex Buddy 之后，不要再写安装目录。那个目录只放代码，覆盖安装会整份换成新包，写在里面的文件会一起被换掉。

Dex Buddy 在 `ctx.dirs` 上给出两个目录。密钥和选项仍然走设置页，见 [设置](settings.md)，不要把它们放进这些目录。

## 开发时

软链接或 `config.dev.json` 挂进来时，`ctx.dirs.data` 就是插件仓库，`ctx.dirs.cache` 是仓库里的 `cache/`。继续写仓库里的目录：

```text
my-tool/
├── cache/          删掉可以重建的缓存
├── output/         导出。写在 ctx.dirs.data 下面
└── app.db          数据库，文件名自定
```

仓库里已有 `.venv` 或 `node_modules` 时，Dex Buddy 直接用它们，不另建 `plugin-runtime`。开发环境要作者自己建、自己装。宿主不创建虚拟环境，也不按 `requirements.txt` 安装。改了依赖文件也不会更新这份 `.venv`。声明了 Python 但没有 `.venv` 时，插件不执行 `apply`，插件页显示「开发目录里没有 .venv」。可以重试，重试不会替你建 `.venv`。声明了 Node 但没有 `node_modules` 时同样，错误是「开发目录里没有 node_modules」，作者自己在仓库里 `npm ci`。

## 安装之后

代码落在 `userData/installed_plugins/<插件 id>/`。这个目录只放源码，覆盖安装会整份换成新包。

```text
userData/
├── runtimes/                         全机共用的 uv、Python、官方 Node
├── installed_plugins/<插件 id>/      源码
├── plugin-runtime/<插件 id>/
│   ├── env/                          这个插件的虚拟环境或 node_modules
│   └── cache/                        ctx.dirs.cache
└── plugin-data/<插件 id>/            ctx.dirs.data
    ├── output/
    └── app.db
```

`userData` 是 Electron 的 `app.getPath('userData')`。不要自己拼这三条路径，用 `ctx.dirs`。不要把缓存写进 `plugin-data`。

页面没有 Node，不能自己写文件。需要落盘时，由页面调用 `window.dex.call`，在 `index.js` 里写。见 [运行](runtime.md)。

子进程要写这些目录时，把 `ctx.dirs` 里的绝对路径当参数传进去。

## 更新和卸载

覆盖安装只替换 `installed_plugins/<插件 id>/`，不会先卸载。`plugin-data` 留下。`plugin-runtime/<id>/install.json` 里的 uv、Python、Node 版本或依赖哈希变了，才重建 `env/`。Dex Buddy 升级若改了这三个版本常量，已安装的环境会重建。锁没变、版本也没变，才跳过。

卸载已安装的插件时，Dex Buddy 删掉安装目录、整个 `plugin-runtime/<插件 id>/`，并删掉 `plugin-settings.json` 里这一插件的配置。`plugin-data/<插件 id>/` 和全机的 `runtimes/` 留下。再次安装同一 id 时，导出和数据库还在，依赖按锁文件重装。

`dispose` 用来关掉进程、数据库连接，不要在里面删除 `plugin-data` 或 `plugin-runtime`。

## 打包

源码仓库里的 `cache/`、`output/`、`temp/` 不要打进 zip。装好之后的缓存走 `plugin-runtime`，导出和数据库走 `plugin-data`。打包排除见 [发布](ship.md)。
