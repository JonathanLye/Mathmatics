# contracts · 三端共用契约

这里的文件是三端（学生端、教师端、服务端）之间唯一的约定。任何一端要改它，都必须开 PR，另外两端的负责人同意后才能合并。代码里的类型从这里生成，不手写第二份。

| 文件 | 内容 | 谁用 |
|---|---|---|
| `openapi.yaml` | 全部 HTTP 接口（OpenAPI 3.1） | 三端；前端用它生成请求类型和 mock |
| `events.schema.json` | 事件信封与 78 种事件的 payload（由 `tools/events-catalog.mjs` 生成，勿手改） | 三端；导出与研究 |
| `problem-package.schema.json` | 题目包（public / secret 两部分） | 服务端引擎、导入流水线、教师审核界面 |
| `concept.schema.json` | 概念库：定义卡、分步微课、图解、术语词条 | 服务端、学生端微课页 |
| `schema.sql` | PostgreSQL DDL（49 张表含分区） | 服务端 |
| `keyboard-layout.json` | 证明键盘布局 | 学生端 |
| `seed/*.json` | v3 的两道题 + 两道迁移题 + 概念库 + 事件样例 | mock、测试基线、上线首批内容 |
| `tools/canon.mjs` | `canon()` 参考实现（公式规范化） | 服务端 `packages/engine/canon` 必须与它结果一致 |
| `tools/check-*.mjs` | 发布门禁与契约自检 | CI |

## 自检

```bash
cd 证明陪练场_产品设计工作区/10-开发文档/contracts
npm install
npm run check
```

`npm run check` 依次跑以下检查，全部通过才算契约可用：

0. `check-generated`：`events.schema.json` 与 `tools/events-catalog.mjs` 是否同步、`08` §3 的 `GENERATED` 区间是否与 `--markdown` 一致。
1. `check-seeds`：题目包 schema、KaTeX 能否渲染、关键步骤样例自测、**穷举泄题检查**、`canon()` 回归用例、证明键盘片段可渲染。
2. `check-events`：事件样例符合 schema；前端不能上报服务端事件（防伪造）。
3. `check-sql`：用 PGlite 执行 `schema.sql`，并验证"事件只追加""已发布题目包不可改""同一布置每人一个主作答"。
4. Redocly lint `openapi.yaml`。

## 本地 mock（前端不等后端）

```bash
npx @stoplight/prism-cli@5 mock openapi.yaml -p 4010
```

前端开发时把 `/api/v1` 代理到 `http://127.0.0.1:4010`。需要真实的作答状态时，用 `seed/epsN.json` 的公开部分拼 `AttemptState`（学生端 `src/mocks/` 里放几份典型状态：第 1 层刚进入、第 3 层写了两行有一条批注、额度用完、完成）。

## 改契约的规则

- 字段只增不删。要改名：先加新字段，旧字段保留一个学期，事件 payload 同理。
- 新增事件：只改 `tools/events-catalog.mjs`，再运行 `node tools/events-catalog.mjs` 重新生成 schema，并把 `node tools/events-catalog.mjs --markdown` 的输出贴进 `08-事件与数据字典.md` §3。
- 改 `canon()`：先在 `check-seeds.mjs` 的 `CANON_CASES` 里加用例，再改实现，两端同时改。
- 改题目包 schema：所有 seed 必须仍能通过 `check-seeds`。
- `package-lock.json` 必须入库；`check-generated` 守护生成物同步；`@redocly/cli` 固定 2.72.1。
