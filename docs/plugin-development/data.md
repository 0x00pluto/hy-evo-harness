# 数据

[返回目录](README.md)

开发时，缓存、导出和数据库写在插件仓库里。打成 zip 装进 Dex Buddy 之后，不要再写安装目录。那个目录只放代码，覆盖安装会整份换成新包，写在里面的文件会一起被换掉。

Dex Buddy 没有在 `ctx` 上提供数据目录。插件在 `index.js` 里自己选路径。密钥和选项仍然走设置页，见 [设置](settings.md)，不要把它们放进这些目录。

## 开发时

软链接或 `config.dev.json` 挂进来时，`index.js` 就在插件仓库里。继续写仓库里的目录：

```text
my-tool/
├── cache/          删掉可以重建的缓存
├── output/         导出
└── app.db          数据库，文件名自定
```

这些目录留在你自己的仓库里，方便对着源码看结果。

## 安装之后

代码落在 `userData/installed_plugins/<插件 id>/` 时，改写到旁边的用户数据目录：

```text
userData/plugin-data/<插件 id>/
├── cache/
├── output/
└── app.db
```

`userData` 是 Electron 的 `app.getPath('userData')`。不要把数据写进 `installed_plugins/<插件 id>/`。

`pluginId` 用清单里的 `id`。`__dirname` 在这个安装目录下面，说明已经是装好的插件，用 `plugin-data`。否则还在开发，用仓库目录。

```javascript
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function pluginDataDir(pluginId) {
  const installedRoot = path.resolve(app.getPath('userData'), 'installed_plugins', pluginId);
  const here = path.resolve(__dirname);
  const relative = path.relative(installedRoot, here);
  const installed = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  const root = installed
    ? path.join(app.getPath('userData'), 'plugin-data', pluginId)
    : here;
  fs.mkdirSync(path.join(root, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  return root;
}
```

页面没有 Node，不能自己写文件。需要落盘时，由页面调用 `window.dex.call`，在 `index.js` 里写。见 [运行](runtime.md)。

子进程要写这些目录时，把算好的绝对路径当参数传进去。不要让脚本自己去猜插件安装目录。

## 更新和卸载

这一节只针对安装之后的 `plugin-data`。开发仓库里的 `cache/`、`output/` 和数据库留在仓库里，Dex Buddy 不动它们。

再次安装同一个插件，Dex Buddy 只替换 `installed_plugins/<插件 id>/`。`plugin-data/<插件 id>/` 留在原地，缓存和数据库还在。

卸载已安装的插件时，Dex Buddy 删掉安装目录，并删掉 `plugin-settings.json` 里这一插件的配置。它不会删 `plugin-data`。这份数据会留在用户机器上。

覆盖安装前会先卸载再装上，这时也会调用 `dispose`。`dispose` 用来关掉进程、数据库连接，不要在里面删除 `plugin-data`。

## 打包

源码仓库里的 `cache/`、`output/` 不要打进 zip。装好之后产生的文件走 `plugin-data`，不靠包里的这两个文件夹。打包排除见 [发布](ship.md)。
