# 第一期：仓库划分与登录 / 会话

收费卖什么、接口形状与实现顺序见 [phase1-billing.md](phase1-billing.md)。分期与技能中心可借鉴边界见 [phase1-roadmap-and-skills-gate.md](phase1-roadmap-and-skills-gate.md)。本文只记：**几个仓、三种页面、登录如何交到桌面、之后怎么带 token 调网关**。

**这不是已上线功能。** 工作台今天没有登录，也没有网关仓。

---

## 两个代码仓，三条运行时

| 仓 / 运行时 | 职责 | 第一期 |
|---|---|---|
| 本仓（Electron 工作台） | 点登录 → 打开系统浏览器；`safeStorage` 存 refresh token；展示余额与买断；主进程带会话转发模型请求 | 要改 |
| 新建网关仓（Next.js，Vercel + Supabase） | 唯一登录页、会话、买断、钱包、流水、持供应商 Key 转发文案 / 生图；以后的管理后台也加在这一仓 | 新建，不进本仓 |
| 已有插件仓（如小红书） | 本机拼提示词；`complete` / 生图改为走宿主 | 要改；不新开「前端项目」 |

本仓按 `AGENTS.md` 不拥有数据库和 HTTP API，所以网关必须新仓。

**明确不做：**

- 把 API 再拆成第三个「纯后端」仓（页面与 API 同仓部署，技能中心同形）
- 整仓 fork `huyuan-ai-skills-gate`
- 第一期单独开「管理后台项目」

```text
插件本机拼提示词
  → 宿主附上会话 + pluginId + 幂等键
  → 网关：验会话 → 买断校验 → 扣费 → 转发供应商
  → 宿主把文本或 PNG 交回插件
```

---

## 三种页面：别混成一件事

| 页面 | 谁用 | 第一期 |
|---|---|---|
| `/login` | 用户自己登手机号 | **要做**，且全产品只有这一处登录 |
| 账户 / 余额 | 用户看买断、余额、流水 | **主界面在 Dex Buddy**；网站可有一页极简 `/account`，读同一份 whoami |
| 管理后台 | 销售查人、补授权、调额度、看流水 | **不做**（属 P1.5）。第一期销售在 Supabase 按手机号写 `entitlements` + 赠送流水 |

技能中心的企业管理页（组织、成员、邀请、技能治理）是管别人的壳，**不要搬来当用户看钱包**。对第一期有用的是登录页形状与 whoami 权益快照，不是 `app/admin` 或 `/company/admin`。

钱包是预付额度：不够就停，失败退回。账户上表达「余额不足」，不做欠费、挂账、催缴。

余额不要做成两套账。生成前工作台必须能展示「还剩多少、这次大概扣多少」；网站若也做 `/account`，只是同一接口的另一个壳（换电脑、没开客户端时也能看一眼）。

---

## 登录：只在网页登一次，桌面领会话

手机号 OTP 用 Supabase（技能中心那条阿里云短信 Hook 的配置与路由形状可抄）。发给桌面的是**网关自己签发的会话**，不要把 Supabase 的 access token 放进链接或 `safeStorage`。

不自建完整 OAuth 授权服务器（不要客户端注册、scope、同意屏）。一次性码只做「浏览器已经登入」到「这台 Dex Buddy 拿到自己的会话」的桥。

### 主路径：授权码 + PKCE + 自定义协议

对应 OAuth 2.0 授权码 + PKCE（RFC 6749 / 7636）与原生应用建议（RFC 8252）。用户通常看不见码。

```text
Dex Buddy 本机生成 PKCE（只有本机知道的随机值）
  → 打开系统浏览器：网关 /login，地址里只带挑战值
  → 用户在网页上完成手机号验证码（全产品唯一登录 UI）
  → 网页跳到 dexbuddy://auth/callback?code=一次性码
  → Electron 接住，用本机随机值向网关 POST /v1/auth/exchange
  → 拿到 access token + refresh token；refresh 写入 safeStorage
```

### 备用：设备授权（RFC 8628）

自定义协议唤不起应用时再用。用户可能看到或核对短码；桌面用设备内部码轮询，批了再换会话。与主路径共用同一套兑换与会话表。

### 一次性码只干一件事

| 步骤 | 接口（示意） |
|---|---|
| 兑换 | `POST /v1/auth/exchange`（body：`code` + PKCE 校验值，或设备码轮询结果） |
| 刷新 | `POST /v1/auth/refresh`（body：refresh token；轮换后旧 refresh 作废） |
| 退出 | 撤销会话 + 清本机 `safeStorage` |

码用一次即废，不落盘，不带进业务请求。

---

## 之后怎么调网关：三种凭证

| 凭证 | 用途 | 放哪 | 存哪 |
|---|---|---|---|
| 一次性码 | 只打 exchange | 请求体 | 不落盘 |
| access token | 查余额、文案、生图等业务请求 | `Authorization: Bearer <access token>` | 主进程内存；过期即丢 |
| refresh token | 只打 refresh | 请求体，不进业务接口 | Electron `safeStorage` |

Token **只表示已登录用户身份**。买断列表与余额会变，每次请求仍查库，不写进 JWT / token 当真相。

插件页面与渲染进程**不接触**这些字符串。统一由宿主主进程出口补会话、`pluginId`、幂等键。

文案请求示意：

```http
POST /v1/chat/completions
Authorization: Bearer <access token>
X-Plugin-Id: <pluginId>
Idempotency-Key: <稿 id>:<步骤名>

{ "messages": [ ... ] }
```

网关处理顺序（与收费备忘一致）：

1. 验会话（Bearer）
2. 该 `pluginId` 是否已买断（免费能力若也烧模型，则只查余额）
3. 扣额度（同一幂等键成功过则直接返回上次结果）
4. 才用我们的供应商 Key 转发

access token 宜短（例如十五分钟到一小时）。主进程发现快过期或收到 401，用 refresh 换一对新的，写回 `safeStorage`。换电脑再走一遍网页登录；账本跟账号走，不跟某台机器的 token 走。

---

## 网关仓第一期页面与 API（最小集）

**页面：**

- `/login` — 手机号验证码；可带 PKCE 挑战或设备码参数
- `/account` — 可选；一页卡片：手机号、已买断插件、余额、最近几条流水

**API（示意，命名可微调）：**

- 登录交接：exchange / refresh / revoke
- `whoami`（或等价）：身份 + 买断列表 + 余额快照（学技能中心 whoami，字段换成买断与钱包）
- 文案转发、生图包装（见收费备忘）

销售录入：Supabase 按手机号写 `entitlements` + 赠送流水。自助支付与 `/admin` 属 P1.5，仍落在同一网关仓。

---

## 建议开工顺序

与 [phase1-billing.md](phase1-billing.md)「建议实现顺序」对齐，登录侧补全为：

1. **网关：** 手机号 OTP、会话表、exchange / refresh、空钱包、`whoami`
2. **宿主：** 打开浏览器 → PKCE / 回调或设备码 → 换会话 → `safeStorage` → 带 Bearer 打通健康检查或一条文案
3. 文案接口打通并扣费；生成前展示余额与预估
4. 买断（含销售录入）与充值包
5. 生图包装接口；PNG 写回本地稿目录
6. 付费插件去掉终端用户侧的供应商 Key

---

## 第一期做 / 不做（给接手的人）

**做：**

- 新建瘦网关仓；本仓改登录入口与主进程转发；插件改走宿主
- 唯一网页登录；桌面用 PKCE 主路径 + 设备码备用
- Bearer access + `safeStorage` refresh；业务请求带 `pluginId` 与幂等键
- Dex Buddy 内展示余额与买断；可选网站 `/account`

**不做：**

- 技能中心企业管理页整架搬入
- 第一期管理后台 UI（销售改库即可）
- 欠费 / 挂账叙事
- 客户端自备 DeepSeek / Replicate Key 的上线路径（开发机 `.env` 保留）
- 提示词上收、CDN 动态加载业务代码（见收费备忘边界）
