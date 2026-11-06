# AGENTS.md — 给 AI 编码代理的仓库规则

> 本文件对在本仓库工作的所有 AI 代理生效；与用户当轮指令冲突时，以用户指令为准。

## 1. 先读什么

1. `证明陪练场_产品设计工作区/10-开发文档/00-README.md`（唯一入口与决策日志）
2. 与你任务相关的分册（学生端 `02/03`、服务端 `05/06/07/08/09`、教师端 `04`、内容 `10`、防作弊 `11`、计划 `12`、合规 `13`）
3. `CONTRIBUTING.md` 与当前 issue；issue 里的 DoD 是验收标准。

文档冲突时：`10-开发文档` > 历史 `07`/`08`/`09`；代码与契约冲突时先停下来问，不要自己发明规则。

## 2. 目录边界

```text
apps/student   A；packages/ui-math A
apps/server    B；packages/engine B；apps/worker B
apps/teacher   C；apps/server/src/routes/teacher、apps/server/src/services/teacher（/teacher/* 接口）C，B 审
10-开发文档/contracts  B 维护，所有人生效
```

不要跨边界改别人的目录；需要改契约/引擎时开 issue 或 PR，并让 owner 评审。

## 3. 绝对禁止

- 直接 push `main`；必须开 PR（基线初始化除外，需 Lead 同意）。
- 手改生成物：`contracts/events.schema.json`、`10-开发文档/08` §3 生成区、`06` §3 生成区、`package-lock.json`（用 npm 生成）。
- 改契约不更新 `10-开发文档` 对应章节 / 不重跑 `npm run check`。
- 提交 `.env`、密钥、token、学生数据、教辅 PDF、截图。
- 为了让测试变绿而删测试、跳过测试、改断言；有问题如实报告。

## 4. 改完必须跑

```bash
cd "证明陪练场_产品设计工作区/10-开发文档/contracts"
npm run check                     # check-generated + seeds + events + sql + redocly
node tools/check-docs.mjs         # 仓库根；文档结构检查
# 有代码后（按 app）：
# pnpm typecheck && pnpm test && pnpm build   # 工作区用 pnpm，不是 npm
```

改了 events 只改 `contracts/tools/events-catalog.mjs`，然后：

```bash
node tools/events-catalog.mjs
node tools/events-catalog.mjs --markdown   # 贴进 08 §3？不要手贴：用脚本/PR 生成
```

`npm run check` 会校验 `events.schema.json` 与 `08` §3 是否同步；不同步就重生成，不要手改。

## 5. 输出要求

- PR/回复里贴**实际命令 + 结果**；没有运行的不要说“已验证”。
- 任务完成前对照 issue 的 DoD 逐条打勾；没达成就说没达成。
- 不确定的产品规则查 `10-开发文档`；查不到就停下来问，不要自己发明。
