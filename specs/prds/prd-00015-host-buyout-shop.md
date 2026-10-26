---
name: prd-00015-host-buyout-shop
sequence: 15
description: 登录后看出买断了哪些插件，并从工作台打开线上商城；功能清单，落地前须技术讨论。
status: backlog
created: 2026-10-26T02:24:44Z
---

# PRD: 买断查询与打开商城

| 属性 | 值 |
|---|---|
| 状态 | backlog |
| 范围 | 功能清单。依赖 [`prd-00013-prod-gateway-base.md`](./prd-00013-prod-gateway-base.md) 的线上默认域名；与 00014 可分开关 |
| 关联文档 | `docs/memo/phase1-billing.md`；兄弟仓 OpenAPI `../0001-HyHarness-gateway/public/openapi.json` |
| 姊妹 PRD | 域名与会话 [`prd-00013-prod-gateway-base.md`](./prd-00013-prod-gateway-base.md)；文案转发 [`prd-00014-host-chat-egress.md`](./prd-00014-host-chat-egress.md)；生图 [`prd-00016-host-image-generate.md`](./prd-00016-host-image-generate.md) |

## 1. 背景

线上已有买断查询和 `/shop` 支付宝商城。工作台今天能登录、能看积分，看不出买了哪些插件，也不能从客户端进商城。本文单独立项，不并进 00013，也不拦 00014 的文案调用。

默认打 `https://www.dexbuddy.app`。不跟本机网关联调。

## 2. 功能清单

- 登录后能看出当前账号买断了哪些插件。
- 从工作台打开线上商城 `https://www.dexbuddy.app/shop`。
- 从商城回到工作台后，能重新看到买断与余额。

## 3. 非目标

- 在客户端里做支付或扫码收银台。
- 文案转发（见 00014）。
- 生图（见 00016）。
- 改网关、本机网关联调。
- Release 1 及更高版本占位。

网页登录和桌面会话是否打通，留到技术讨论，本文不先定方案。

## 4. 落地前技术讨论

本文只列功能，不能直接开工。接口怎么挂、失败怎么返回、界面落在哪，须先做技术讨论，把结论补回本文，再改代码。
