---
name: prd-00014-host-chat-egress
sequence: 14
description: 插件经宿主调用线上模型目录、生成前报价与文案补全；功能清单，落地前须技术讨论。
status: backlog
created: 2026-10-26T02:24:44Z
---

# PRD: 宿主文案转发

| 属性 | 值 |
|---|---|
| 状态 | backlog |
| 范围 | 功能清单。依赖 [`prd-00013-prod-gateway-base.md`](./prd-00013-prod-gateway-base.md) 的线上默认域名 |
| 关联文档 | `docs/memo/phase1-billing.md`、`docs/memo/phase1-repos-and-auth.md`；兄弟仓 OpenAPI `../0001-HyHarness-gateway/public/openapi.json` |
| 姊妹 PRD | 域名与会话 [`prd-00013-prod-gateway-base.md`](./prd-00013-prod-gateway-base.md)；买断与商城 [`prd-00015-host-buyout-shop.md`](./prd-00015-host-buyout-shop.md)；生图 [`prd-00016-host-image-generate.md`](./prd-00016-host-image-generate.md) |

## 1. 背景

线上网关已提供模型目录、报价和文案补全。工作台今天只会登录并展示积分，插件不能经宿主烧额度。本文单独立项，不并进 00013。

默认打 `https://www.dexbuddy.app`。不跟本机网关联调。

## 2. 功能清单

- 插件经宿主调用线上的模型目录、生成前报价、文案补全。
- 余额不够时不把请求转到上游。
- 插件页面不自己请求网关，也不拿到 token。
- 扣费结果仍以现有积分余额为准，不在文案响应里另做一份账。

## 3. 非目标

- 生图（见 00016）。
- 买断列表与打开商城（见 00015）。
- 改外部插件仓、去掉用户侧供应商 Key。
- 改网关、本机网关联调、流式输出、用户 API Key。
- Release 1 及更高版本占位。

## 4. 落地前技术讨论

本文只列功能，不能直接开工。接口怎么挂、失败怎么返回、界面落在哪，须先做技术讨论，把结论补回本文，再改代码。
