# mocks —— 典型 AttemptState（issue #9 / #26）

> 契约真源：`10-开发文档/contracts/openapi.yaml` 的 `AttemptState`。
> 这里的数据只用于「#18/#19 未完成时」让 UI 可跑、可验收；字段名与结构必须和契约一致。

## 典型 mock（`src/mocks/attemptStates.ts`）

| key | 场景 | 覆盖的 UI 状态 |
|---|---|---|
| `l1-active` | 第 1 层进行中（新题） | 表单、层导航锁定态、预算 0、微课入口 |
| `l3-active` | 第 3 层进行中（2 行 + 行内批注） | 行列表、红笔批注、canFinish=false |
| `l3-exhausted` | 透露额度用尽 + 长时间卡住 | 软着陆四出路、琥珀色提示、`help.exhausted` |
| `l3-ready` | 第 3 层可点「写完了」（#26 全流程起点） | 行列表、canFinish=true |
| `l4-active` | 第 4 层自检（4 道题、带维度/次数） | 自适应选题、只读证明、追问/次数用尽 |
| `l5-active` | 第 5 层迁移题入口（等待「开始迁移题」） | 迁移题入口、#47 思路对照图 |
| `l6-active` | 第 6 层总结（五问待答） | 总结表单 |
| `completed` | 本题完成（第 6 层） | 完成卡片、独立度、leanCard、证明本入口 |

第 1 层微课、自检题、迁移题面、总结五问、证明本列表的内容在 `src/mocks/laterLayers.ts`（取自
`contracts/seed/concepts.json` / `epsN.json` / `epsN-T1.json` 与 01/02 文档），真实接口接入后由服务端下发（#24）。

## #47 接线带来的 mock 扩展（真实接口前）

- **迁移题完整流程**：`startTransfer` 返回 kind=transfer 的子作答 state（parentAttemptId、六层只启用 L3、预算 1）；
  `addTransferLine / editTransferLine / deleteTransferLine / finishTransfer` 由 mock reducer 近似归类 + 判定 canFinish；
  子作答完成后 `completeTransferParent` 推进父作答 L5→L6。真实接口对应 `/transfer`、`/lines`、`/finish`（#24）。
- **自检自适应**：`SelfcheckItem.dimension/attempts` 与 `SelfcheckView.records` 是 mock 扩展字段，
  用于 `components/selfcheck/adaptive.ts` 选题；契约里的真源是服务端判定 + 下发（#24）。
- **证明本稍后重做**：`NotebookCard` 增加 independence/redoRecommended/completedAt/problemId 等字段，
  供 `components/proofbook/redo.ts` 分档排序；真实数据来自 `GET /student/notebook`（#74/#24）。
- **图解**：微课 VisualSpec 的 `abs-triangle` 是 mock 扩展 type（03 §7 契约 type 只有五种），
  真实接口前由本地 mock 提供；`seq-band` 仍用契约 type（expr→序列点，不出现本题的数列）。

做题页切换方式：
1. 页面底部右下角的 `mock: …` 悬浮按钮（`MockSwitcher.vue`）；
2. 直接访问带参数的路由：`#/pages/practice/index?mock=l1-active`（H5）。

## AIGC 标识 mock（Refs #37 / task-90）

- **默认无生成内容**（与线上 P0 一致）：mockLesson.generated = null，微课不显示 AIGC 标签。
- **测试/演示开关**：H5 URL 带 `?aigc=1`（hash 或 search 均可）时，fetchLesson 返回 mockGeneratedLesson（generated 为占位文本），用于验证 AiGeneratedTag 的显隐、tokens/深色兼容；不带参数时标签不出现。
- 该开关**只验证渲染能力**：不启用真实生成、不伪造 AI 数学内容；真实数据一律以服务端 LessonView.generated 为准（B 侧若启用生成，必须同批加显式标识与 X-AIGC 响应头，见 13 合规）。
- e2e：npm run e2e:flows:aigc（先 build:mock）。

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
