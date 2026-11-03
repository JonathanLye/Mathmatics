# mocks —— 4 份典型 AttemptState（issue #9）

> 契约真源：`10-开发文档/contracts/openapi.yaml` 的 `AttemptState`。
> 这里的数据只用于「#18/#19 未完成时」让 UI 可跑、可验收；字段名与结构必须和契约一致。

## 四份 mock（`src/mocks/attemptStates.ts`）

| key | 场景 | 覆盖的 UI 状态 |
|---|---|---|
| `l1-active` | 第 1 层进行中（新题） | 表单、层导航锁定态、预算 0 |
| `l3-active` | 第 3 层进行中（2 行 + 行内批注） | 行列表、红笔批注、canFinish=false |
| `l3-exhausted` | 透露额度用尽 + 长时间卡住 | 软着陆四出路、琥珀色提示、`help.exhausted` |
| `completed` | 本题完成（第 6 层） | 完成卡片、独立度、leanCard、证明本入口 |

做题页切换方式：
1. 页面底部右下角的 `mock: …` 悬浮按钮（`MockSwitcher.vue`）；
2. 直接访问带参数的路由：`#/pages/practice/index?mock=l1-active`（H5）。

## Prism mock（契约级 mock server）

```bash
# 在 apps/student 下：
npm run mock:contracts
# 等价于：
npx prism mock ../../packages/contracts/openapi.yaml -p 4010
```

用途：给「按 OpenAPI 校验请求/响应」的联调阶段用（issue #24 接真实 API 时）。
当前 P0 的 `src/api/client.ts` 是**本地 mock reducer**（不依赖 Prism），Prism 作为契约级后备保留。

## 与真实接口的切换（#24）

`apps/student/src/api/client.ts` 顶部 `USE_MOCK = true`。
接真实接口时改为 false，并补：
- 写请求带 `Idempotency-Key`（uuid）与 `If-Match: stateVersion`；
- `409 STATE_STALE` 用响应里的 `state` 覆盖本地；
- 契约校验不通先停下来问 B（契约 owner），不要自己改契约。
