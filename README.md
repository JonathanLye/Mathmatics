# 证明陪练场（Proof Gym）

> 数学分析证明题练习产品：学生在手机上分步手写证明，AI 只给最小提示、绝不替写；教师看到的是过程数据，不是分数。

## 先看哪里

| 想做什么 | 去哪 |
|---|---|
| 读需求/规格（唯一入口） | [证明陪练场_产品设计工作区/10-开发文档/00-README.md](证明陪练场_产品设计工作区/10-开发文档/00-README.md) |
| 跑契约自检 | `cd "证明陪练场_产品设计工作区/10-开发文档/contracts" && npm ci && npm run check` |
| 看历史设计/交互基线 | [`07-重构审计与方案/`](证明陪练场_产品设计工作区/07-重构审计与方案/)、[`08-重构原型/index.html`](证明陪练场_产品设计工作区/08-重构原型/index.html) |
| 看旧版 Demo/过程材料 | `00-过程记录/`、`05-演示原型/`、`06-前后端Demo/`、`研究笔记/` |
| 复审记录（内部） | `证明陪练场_产品设计工作区/11-开发文档复审/`（本地目录，当前未入库） |

**冲突裁决**：`10-开发文档/` 是现行唯一开发口径；`07`/`08`/`09-设计原理说明书` 是历史材料；旧文与开发文档冲突时，以开发文档为准。

## 目标仓库结构（Day 0 创建）

```text
Mathmatics/
├─ 证明陪练场_产品设计工作区/10-开发文档/   # 需求、契约、seed、门禁（已入库）
├─ apps/                                  # Day 0 创建
│  ├─ student/     A：学生端（uni-app H5）
│  ├─ teacher/     C：教师端（Vue 3 + TDesign）
│  └─ server/      B：Fastify + PostgreSQL + worker
├─ packages/
│  ├─ engine/      B：纯函数引擎（规则、预算、闸门、回放）
│  ├─ ui-math/     A：MathText/手写/键盘
│  └─ contracts/   B：从 10-开发文档/contracts 复制/同步，唯一源仍是 10-开发文档/contracts
├─ infra/          B：Docker Compose、Caddy、备份、.env.example
├─ .github/        工作流、CODEOWNERS、Issue/PR 模板
├─ tools/          仓库级校验脚本
├─ CONTRIBUTING.md 协作规则（分支/PR/评审/DoD）
└─ AGENTS.md       给 AI 编码代理的仓库规则
```

## 当前状态（2026-11-02）

- 开发文档 v1.1 已入库（A1–A6 修订）。
- 契约门禁：`check-generated` + `check-seeds` + `check-events` + `check-sql` + `redocly` 全绿（本机）。
- 代码目录尚未创建；Day 0 按 `12-分工与开发计划.md` 建 monorepo。
- GitHub 侧已配置 `main` 规则集：只能通过 PR 合并，需要 1 人批准和 `ci-gate` 通过（细则见 CONTRIBUTING §4）。

## 协作

| 角色 | GitHub | 范围 |
|---|---|---|
| A | `XuJinSheng1111111` | 学生端、`packages/ui-math` |
| B（兼 Lead） | `JonathanLye` | 服务端、引擎、worker、契约、部署 |
| C | `lzjzj-creator` | 教师端（页面 + `/teacher/*` 接口）、导入 |

- 任务用 GitHub Issue 跟踪（一个可交付 = 一个 issue，含 DoD）；里程碑 `Day0`–`Day3`、`P1`。
- `main` 不可直接 push；分支命名、PR 模板、评审规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 契约（`10-开发文档/contracts/`）只由 B 维护；任何契约 PR 必须 B + A/C 至少一人评审，并附 `npm run check` 输出。
