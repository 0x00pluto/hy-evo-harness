---
name: prd-00016-host-image-generate
sequence: 16
description: 插件经宿主上传参考图并按张生图，结果落到本地文件；功能清单，落地前须技术讨论。
status: backlog
created: 2026-10-26T02:24:44Z
---

# PRD: 宿主生图

| 属性 | 值 |
|---|---|
| 状态 | backlog |
| 范围 | 功能清单。依赖 [`prd-00013-prod-gateway-base.md`](./prd-00013-prod-gateway-base.md) 的线上默认域名 |
| 关联文档 | `docs/memo/phase1-billing.md`；兄弟仓 OpenAPI `../0001-HyHarness-gateway/public/openapi.json` |
| 姊妹 PRD | 域名与会话 [`prd-00013-prod-gateway-base.md`](./prd-00013-prod-gateway-base.md)；文案转发 [`prd-00014-host-chat-egress.md`](./prd-00014-host-chat-egress.md)；买断与商城 [`prd-00015-host-buyout-shop.md`](./prd-00015-host-buyout-shop.md) |

## 1. 背景

线上网关已包装参考图上传和按张生图。工作台今天没有把这两步交给插件用的出口。本文单独立项，不并进 00013。

与 00014 的出口是否共用，留到技术讨论，不在本文先定。默认打 `https://www.dexbuddy.app`。不跟本机网关联调。

## 2. 功能清单

- 插件经宿主上传参考图并发起按张生图。
- 生成结果回到插件能用的本地文件。
- 插件页面不接触上传凭证，也不直接打开供应商地址。

## 3. 非目标

- 文案接口（见 00014）。
- 买断与商城（见 00015）。
- 改外部插件仓。
- 改网关、本机网关联调。
- Release 1 及更高版本占位。

## 4. 落地前技术讨论

本文只列功能，不能直接开工。接口怎么挂、失败怎么返回、界面落在哪，须先做技术讨论，把结论补回本文，再改代码。
