# 设置

[返回目录](README.md)

密钥和选项在工作台的设置页里填。点图标轨底部的齿轮，在弹出层里选「设置」，再选中你的插件，改完点「保存」。配置写在用户数据目录的 `plugin-settings.json`，按插件 `id` 分开。覆盖安装不会清掉它。用户卸载已安装的插件之后，对应的一块会被删掉。内置插件和开发路径不能从界面卸载，配置会留着。

工作台不读 `.env`，也不替你写 `.env`。脚本本身只认环境变量，不引用 Dex Buddy：

- 在工作台里跑：`index.js` 拉起子进程时传入 `{ env: ctx.pluginEnv() }`。设置页里的值这时已经在环境里。
- 离开工作台单独跑：脚本自己加载项目里的 `.env`。已有的环境变量优先，这样工作台注入的值不会被 `.env` 盖掉。

`.env` 可以留在你自己的仓库里做本地调试，不要打进 zip。

Python 示例：

```python
import os
from dotenv import load_dotenv

load_dotenv(override=False)

api_key = os.getenv("OPENAI_API_KEY")
tts_engine = os.getenv("TTS_ENGINE", "edge-tts")
```

`configSchema` 的键名就是环境变量名：以大写字母开头，只含大写字母、数字和下划线。

```json
{
  "configSchema": {
    "OPENAI_API_KEY": {
      "type": "string",
      "title": "OpenAI API Key",
      "description": "用于生成文本的密钥",
      "default": "",
      "secret": true,
      "group": "模型"
    },
    "TTS_ENGINE": {
      "type": "select",
      "title": "语音合成引擎",
      "options": ["edge-tts", "azure-tts"],
      "default": "edge-tts",
      "group": "语音"
    },
    "MAX_RETRY": {
      "type": "number",
      "title": "最大重试次数",
      "default": 3
    }
  }
}
```

- `string`：单行文本。`"secret": true` 时，正在输入显示明文，保存之后变成圆点。点输入框旁的眼睛可以查看已保存的明文，再点藏回圆点。插件自己的页面仍然读不到明文。留空保存会保留原密钥，要点「清除」才变成空字符串。
- `group`：可选。去掉首尾空白后 1–32 个字符。不写或空字符串时，这一项归入「通用配置」。详见下面「分组怎么排」。
- `boolean`：开关。
- `number`：数字。
- `select`：`options` 是非空字符串数组，`default` 必须是其中一项。
- `path`：目录。设置页的「更改」打开系统目录选择。要填文件路径时用 `string`。

`title` 必填，`description` 可以不写。

## 分组怎么排

上面这份声明在设置页上是三块，顺序跟字段第一次出现的位置一致，不按组名字母排：先是「模型」（密钥），再是「语音」（语音引擎），最后是「通用配置」（只有最大重试次数，因为它没写 `group`）。组名在框外，这一组的字段收在同一个圆角框里。

- 组的位置是这个名字第一次出现的地方。「通用配置」不固定在最前或最后。每一项都写了 `group` 时，不显示空的「通用配置」。
- 去掉首尾空白后文字相同，就合成同一个框。框里的字段仍按它们在 JSON 里的先后排列。中间夹着别的组时，后面的同名项并回先出现的那一块，不会再画第二个标题。`" 模型 "` 和 `"模型"` 是一组。写成 `"通用配置"` 就并进默认那一块，不会出现两个标题。大小写不同是两组，例如 `"Model"` 和 `"model"`。
- 组只有标题，一直展开。不能给组另写说明，也不能单独指定组的顺序。
- 组名不写入 `plugin-settings.json`。改组名、拆组、并组都不迁移，也不删除已保存的值。`saveSettings` 只提交 `values` 和 `secrets`，自定义设置页不用传 `group`。`group` 不进 `getPluginConfig()`，也不进 `pluginEnv()`。

某一项的 `group` 超过 32 个字符，或不是字符串，整份 `configSchema` 这次不可用。插件仍然加载，设置页说明问题，`getPluginConfig()` 返回空对象，`pluginEnv()` 不带这些键。磁盘上的 `plugin-settings.json` 不删。改好声明并重启后，原来的键还会注入。其它字段声明写错也是这样：整份声明暂时不注入，已保存的值留在磁盘上。

接入时按这个顺序：

1. 在 `plugin.manifest.json` 写 `configSchema`。键名必须和脚本里 `os.getenv` 或 `process.env` 的名字一致。
2. 改了 manifest 要重启 Dex Buddy。重启后，从图标轨齿轮弹出层进入「设置」，就会看到这个插件。
3. 在设置页填完，点「保存」。之后再调用 `pluginEnv()` 就是新值，不用为了改一项再重启。
4. `index.js` 里 `execFile` 或 `spawn` 必须传入 `{ env: ctx.pluginEnv() }`。漏传时，脚本只能看到 Dex Buddy 进程自己的环境，看不到设置页里的值。写法见 [运行](runtime.md)。
5. 日志里不要打印密钥。

`settingsEntry` 指向插件目录里的 HTML。有合法声明时，设置页上面是生成的表单，下面是这个页面。只有自带页面、没有合法声明时，设置页只显示这个页面。页面没有 Node，读写的是同一块配置，而且读不到其他插件，也读不到已保存的密钥明文。明文只在工作台设置页点眼睛时取出：

```javascript
const current = await window.dex.readSettings();
const saved = await window.dex.saveSettings({
  values: { TTS_ENGINE: 'edge-tts', MAX_RETRY: 3 },
  secrets: { OPENAI_API_KEY: { action: 'keep' } },
});
```

`secrets` 里 `keep` 表示不改，`set` 写入新字符串，`clear` 写成空字符串。整节里有一项不合法时，这一次不会写入。
