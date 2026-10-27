# 经宿主调用模型

[返回目录](README.md)

插件不要自己请求网关，也不要在页面里 `fetch` 模型接口。文案和生图写在 `index.js` 或 Python 脚本里。页面只调自己的服务：`window.dex.call`。

开发用你的 Key，上线扣使用者的积分。业务代码不用改。

1. 把 [dex-buddy-sdk.js](snippets/dex-buddy-sdk.js) 拷到插件 `lib/`。用 Python 时再拷 [dex_buddy_sdk.py](snippets/dex_buddy_sdk.py)。不必克隆宿主仓。
2. 对照自己 `lib/` 里的 `SDK_VERSION`（Python 是 `__version__`）和文档母版。不一致就整文件再拷。工作台不提示过期。
3. 本机环境变量 `DEX_BUDDY_API_KEY`（在 dexbuddy.app 账号里创建，`dbh_sk_` 开头）。可选 `DEX_GATEWAY_BASE_URL`。SDK **不读** `.env` 文件，自己 `export` 或 `load_dotenv`。不要提交 Key，不要写进 `configSchema`。
4. `index.js` 里从 SDK 调 `requireEntitlement(ctx)` 和 `bindModels(ctx)`，不要直接碰 `ctx.models` / `ctx.requireEntitlement`（独立跑没有它们）。
5. 拉起 Python 时必须先 `await requireEntitlement(ctx)`，再 `spawn(..., { env: await childEnv(ctx, env) })`。同一份 `.py` 不用写 `if dex`。
6. 打包会丢掉 `.env`，见 [打包](pack.md)。装进 Dex Buddy 后 SDK 走登录会话，宿主用清单 `id` 盖 `X-Plugin-Id`。参数和 JSON 体里都不要传 `pluginId`。谁打开插件，扣谁的积分。

```js
const { bindModels, requireEntitlement, SDK_VERSION } = require('./lib/dex-buddy-sdk');

ctx.registerService('myTool', {
  async draft(params) {
    await requireEntitlement(ctx);
    const models = bindModels(ctx);
    return models.chat.completions.create({
      model: 'dexbuddy-chat',
      messages: [{ role: 'user', content: params.prompt }],
    });
  },
});
```

把校验放在自己的服务方法里、烧模型或其它要买断的步骤之前。无参，不要传 `pluginId`。页面只 `window.dex.call`。这个函数不看积分；积分仍在后来的 `chat` / `images`。失败时不要自己画登录 / 购买文案，工作台会弹框。打开插件时不要自动调用。

独立跑时同一行直接通过，不打 entitlements，也不要求登录。

Python 脚本本身：

```python
from dex_buddy_sdk import bind_models, require_entitlement

def pick_model(listed, kind, fallback):
    data = listed.get("data") if isinstance(listed, dict) else None
    if not isinstance(data, list):
        data = []
    for item in data:
        if isinstance(item, dict) and item.get("kind") == kind and isinstance(item.get("id"), str):
            return item["id"]
    return fallback

require_entitlement()
models = bind_models()
listed = models.list()
body = models.chat.completions.create({
    "model": pick_model(listed, "chat", "dexbuddy-chat"),
    "messages": [{"role": "user", "content": prompt}],
})
```

`require_entitlement()` 始终直接返回。工作台真校验写在 Node 的 `index.js`：先 `await requireEntitlement(ctx)` 再 `spawn`。

工作台里由 Node 注入环境，同一份 `.py` 不必分支：

```js
const { spawn } = require('node:child_process');
const { childEnv, requireEntitlement } = require('./lib/dex-buddy-sdk');

await requireEntitlement(ctx);
const env = await childEnv(ctx, { ...process.env, ...(ctx.pluginEnv ? ctx.pluginEnv() : {}) });
spawn(pythonBin, [script], { cwd: __dirname, env });
```

对照例子在仓库 `plugins/models-playground/`（只在 `pnpm start` 出现）。当前母版 `SDK_VERSION` 是 `1.0.0`。

这份 SDK 只用标准库（Node `http` / Python `urllib`）。不声明 `runtime.python`，工作台会走 PATH 上的 `python3`。只有脚本要装 pip 包时才在清单里声明 `runtime`，写法见 [运行](runtime.md)。

提示词仍由插件在本机拼好。模型 id 用 `list()` 返回的渠道 Model ID，按 `kind` 选用；目录为空时回退 `dexbuddy-chat`（文案）或 `dexbuddy-image`（生图）。不要写供应商的模型路径或 URL。不要用 OpenAI 官方 Key 打我们的网关。

下面例子里的 `pickModel` 按 `kind` 从 `list()` 里选渠道 Model ID：

```js
function pickModel(list, kind, fallback) {
  const data = list && Array.isArray(list.data) ? list.data : [];
  const found = data.find((item) => item && item.kind === kind && typeof item.id === 'string');
  return found ? found.id : fallback;
}
```

## 四个方法

下面的 `models` 都来自 `bindModels(ctx)`。名字跟网关路径对应。请求体字段保持 OpenAI / Replicate 的习惯写法。

### `list()`

对应 `GET /v1/models`。真正请求前先列出，再按 `kind` 选用。

```js
const models = bindModels(ctx);
const { data } = await models.list();
// data[].id 是渠道 Model ID
// data[].kind 为 'chat' 或 'image'
const model = pickModel({ data }, 'chat', 'dexbuddy-chat');
```

### `billing.quote(body)`

对应 `POST /v1/billing/quote`。生成前看这次大概扣多少、余额够不够。不替代真正的补全或生图。

文案传入 `model` 与 `messages`。生图传入生图渠道的 `model` 即可。

```js
const models = bindModels(ctx);
const listed = await models.list();
const quote = await models.billing.quote({
  model: pickModel(listed, 'chat', 'dexbuddy-chat'),
  messages: [{ role: 'user', content: prompt }],
});
if (!quote.enough) {
  throw new Error('积分不足');
}
```

### `chat.completions.create(body, options?)`

对应 `POST /v1/chat/completions`。非流式。`body` 就是 OpenAI 补全请求：`model`、`messages`、`temperature`、`max_tokens`、`response_format`、`top_p`、`stop`、`n`。成功体原样交回，含 `choices`，没有顶层账单。`stream: true` 网关会拒绝。

识图走同一条接口，在 `messages[].content` 里放 `image_url`。

可选 `options.idempotencyKey` 会变成 `Idempotency-Key` 头，例如稿 id 加步骤名。不要把它写进 `body`。

宿主在打上游前会先报价，余额不够就不转发。

```js
const models = bindModels(ctx);
const listed = await models.list();
const body = await models.chat.completions.create({
  model: pickModel(listed, 'chat', 'dexbuddy-chat'),
  messages: [{ role: 'user', content: prompt }],
  response_format: { type: 'json_object' },
  temperature: 0.7,
}, { idempotencyKey: 'draft-1:copy' });

const text = body.choices[0].message.content;
```

### `images.generate({ model, input, outputPath }, options?)`

`input` 用 Replicate 已经在用的字段：`prompt`、`aspect_ratio`、`input_images`。`input_images` 是本机文件路径，不是供应商 URL。

宿主自己申请上传凭证、上传字节、再按张生图，把结果写到 `outputPath`（必须是绝对路径）。返回：

```js
{ status: 'succeeded', output: outputPath, model }
```

`output` 是本地路径。插件看不到上传凭证、预测地址和下载地址，也不自己轮询。

生图可能要几分钟。宿主这一侧是一个 Promise。页面按 [运行](runtime.md) 的长任务写法：`dex.call` 先交回任务 id，在 `index.js` 里等待 `images.generate`，完成后再用另一个方法读 `output`。

```js
const models = bindModels(ctx);
const listed = await models.list();
const image = await models.images.generate({
  model: pickModel(listed, 'image', 'dexbuddy-image'),
  input: {
    prompt,
    aspect_ratio: '3:4',
    input_images: [referencePath],
  },
  outputPath,
});
```

## 错误码

方法抛错，错误上有稳定 `code`。`requireEntitlement`、`chat.completions.create` 和 `images.generate` 被拦住时，工作台自己弹框；插件不要再画购买、登录或充值提示，也不要把错误码贴到页面上。调用仍然失败，生成停住。用户买完或登完，再点一次生成。

| code | 何时 | 工作台 |
|---|---|---|
| `UNAUTHORIZED` | 未登录，或会话失效 | 弹「需要登录」 |
| `NOT_ENTITLED` | 这个清单 id 在商城里卖，当前账号还没买断，平台也未限免 | 弹「需要购买插件」 |
| `INSUFFICIENT_CREDITS` | 报价认为余额不够，或网关返回 402。只出现在文案 / 生图 | 弹「积分不够」 |
| 其它 | 网关 `ErrorBody.code` 或 Chat Completions 的 `error.code` 原样映射 | 插件自己处理 |

工作台两条路径都是：未登录 → 未买断 →（仅模型出口）积分不够。`requireEntitlement` 不看积分，不会出现 `INSUFFICIENT_CREDITS`。

`list` 与 `quote` 不拦未买断，也不弹框。文案和生图仍会兜底查买断。

不在商城里的清单 id（自己做的插件，或把官方 id 改成了普通 id）买断视为通过，登录仍要过，烧模型仍报价。平台把目录里的插件标为限免时，两条路径都跳过买断，登录仍要。单机插件打开时不拦。

## 清单 id

仍是小写字母、数字和连字符，见 [清单](manifest.md)。官方新插件建议用 `app-dexbuddy-` 开头，例如 `app-dexbuddy-xiaohongshu`。这只是命名。宿主盖的是文件里写的那个 id。

## 发给用户的包

不要在 `configSchema` 里向终端用户要 `DEX_BUDDY_API_KEY`、DeepSeek 或 Replicate Key。独立跑的 Key 只留在作者本机。装进 Dex Buddy 之后助手走宿主会话，谁用谁付钱。

## 小红书对照（插件仓另改）

本仓不改小红书源码。接到 `bindModels(ctx)` 时：

- `src/llm/client.js` 继续把字符串或 `{ system, user }` 收成 `messages`，然后 `chat.completions.create`。从 `choices[0].message.content` 取文本。原来发给 DeepSeek 的 JSON 字段不用改名。
- 识图仍走 `chat.completions.create`，内容块保持 `image_url`。
- `src/image/generate.js` 不再请求 Replicate，也不轮询。`input.prompt`、`input.aspect_ratio`、`input.input_images` 保持字段名；`input_images` 改为本地路径；`model` 改为 `list()` 里的渠道 Model ID。
