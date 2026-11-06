# 导航协议

[返回目录](README.md)

插件要用工作台打开某一页时，走统一入口 `navigate`，参数是地址字符串。本期只登记「打开调用方自己的设置」；以后登录、积分等另立项扩地址表，不必再加预加载方法或重拷 SDK。

## 入口

| 调用面 | 写法 |
|---|---|
| 插件页面 | 有预加载时 `await window.dex.navigate(href)`；独立打开 HTML 时先判断函数是否存在 |
| 插件后端 `index.js` | 从 SDK：`await navigate(ctx, href)`（推荐） |

两边吃同一套地址。`self` 由宿主按调用方身份解析，不能写成别的插件 id，也不能打开通用设置或积分页。

宿主在工作台注入 `ctx.navigate`。作者从接口层调 `navigate(ctx, href)`：有宿主就转交；**独立跑没有界面时静默成功**（不跳页、不报错），不要直接写 `ctx.navigate`（独立跑没有该字段）。不要改 standalone；导航不是模型实现。接口层现为 `SDK_VERSION` 1.0.4（新增 `navigate` 导出）；之后只扩地址表时不必再升接口版本。

缺某项配置时怎么带用户去填，见 [设置](settings.md) 里的短节。

## 地址表（本期）

| 地址 | 行为 |
|---|---|
| `dex://settings/self` | 打开本插件设置主区 |
| `dex://settings/self#FIELD_KEY` | 打开本插件设置，滚到并聚焦该字段 |

`FIELD_KEY` 须符合 `configSchema` 键规则：大写字母开头，只含大写字母、数字、下划线。对外只认 `#` 片段，不要用 query。

非法示例：`https://...`、空串、`dex://settings/other`、`dex://settings/general`、畸形字段名。

字段键在本插件声明里不存在：仍打开本插件设置，不聚焦，状态栏提示「没有这一项」。

有 `settingsEntry` 自带页、没有宿主生成的表单行时：只选中该插件，**不做**页内 DOM 锚点。

## 错误码

工作台里失败时 Promise reject。错误上带稳定 `code`（若运行时保留该字段）：

| code | 含义 |
|---|---|
| `INVALID_HREF` | 地址非法 |
| `PLUGIN_GONE` | 调用方插件已不在注册表 |
| `NAVIGATE_CANCELLED` | 设置页有未保存草稿，用户取消丢弃 |
| `NO_HOST_UI` | 工作台已加载但没有主窗口（不是独立跑） |
| `NAVIGATE_TIMEOUT` | 打开设置超时 |

独立跑走 SDK `navigate(ctx, href)` 时**不会**抛上述错误，直接成功返回。

## 会话与返回

- 进入设置前，宿主记下当时的活动插件；标题栏后退可回到该插件（与齿轮进设置一致）。
- 由插件 `navigate` 发起的会话：保存成功后自动离开设置并回到该插件。
- 用户从齿轮进入的会话：保存后仍停在设置页。

## 页面样例

```javascript
async function openMyKey() {
  if (!window.dex || typeof window.dex.navigate !== 'function') {
    // 独立打开 HTML：没有工作台预加载，跳过即可
    return;
  }
  try {
    await window.dex.navigate('dex://settings/self#OPENAI_API_KEY');
  } catch (err) {
    console.error(err && err.code ? err.code : 'navigate failed', err);
  }
}
```

## 后端样例

```javascript
const { navigate } = require('./lib/dex-buddy-sdk');

module.exports = {
  apply(ctx) {
    ctx.registerService('myTool', {
      async ensureKey() {
        const config = ctx.getPluginConfig();
        if (!config.OPENAI_API_KEY) {
          await navigate(ctx, 'dex://settings/self#OPENAI_API_KEY');
          return { ok: false, reason: 'need-settings' };
        }
        return { ok: true };
      },
    });
  },
};
```
