# 证明陪练场（Proof Gym）

> 数学分析证明题练习产品：学生在手机上分步手写证明，AI 只给最小提示、绝不替写；教师看到的是过程数据，不是分数。

## 先看哪里

| 想做什么 | 去哪 |
|---|---|
| 读需求/规格（唯一入口） | [证明陪练场_产品设计工作区/10-开发文档/00-README.md](证明陪练场_产品设计工作区/10-开发文档/00-README.md) |
| 跑契约自检 | `pnpm check:contracts`（先同步 `packages/contracts`，再在唯一源目录跑门禁） |
| 看历史设计/交互基线 | [`07-重构审计与方案/`](证明陪练场_产品设计工作区/07-重构审计与方案/)、[`08-重构原型/index.html`](证明陪练场_产品设计工作区/08-重构原型/index.html) |
| 看旧版 Demo/过程材料 | `00-过程记录/`、`05-演示原型/`、`06-前后端Demo/`、`研究笔记/` |
| 复审记录（内部） | `证明陪练场_产品设计工作区/11-开发文档复审/`（本地目录，当前未入库） |

**冲突裁决**：`10-开发文档/` 是现行唯一开发口径；`07`/`08`/`09-设计原理说明书` 是历史材料；旧文与开发文档冲突时，以开发文档为准。

## 仓库结构（#6 已建）

```text
Mathmatics/
├─ 证明陪练场_产品设计工作区/10-开发文档/   # 需求、契约、seed、门禁（唯一源）
├─ apps/
│  ├─ server/      B：Fastify（Node 24 原生运行 TS）
│  ├─ worker/      B：pg-boss 后台任务
│  ├─ student/     A：学生端（uni-app H5）
│  └─ teacher/     C：教师端（Vue 3 + TDesign）
├─ packages/
│  ├─ engine/      B：纯函数引擎（规则、预算、闸门、回放）
│  ├─ contracts/   B：10-开发文档/contracts 的只读同步副本
│  └─ ui-math/     A：MathText/手写/键盘
├─ infra/          B：Docker Compose、Caddy、备份、.env.example
├─ tools/          仓库级脚本（契约同步/门禁、类型生成、启动冒烟、DB）
├─ .github/        工作流、CODEOWNERS、Issue/PR 模板
├─ CONTRIBUTING.md 协作规则（分支/PR/评审/DoD）
└─ AGENTS.md       给 AI 编码代理的仓库规则
```

## 本地开发

需要 Node ≥ 24.12（原生 TypeScript，无构建产物）与 pnpm 12。

```bash
nvm use                 # .nvmrc
pnpm install
pnpm dev                # 起 apps/server，默认 http://127.0.0.1:3000/health
pnpm typecheck          # tsc --noEmit（每个包）
pnpm test               # vitest
pnpm build              # 启动冒烟：真实拉起 server 并请求 /health
pnpm check:contracts    # 契约门禁（同步校验 + 4 项检查 + redocly）
```

### 局域网 / 手机真机联调

默认只监听 `127.0.0.1`。要让同一 Wi-Fi 的手机访问，必须显式监听非回环地址，并且**提供三把密钥**（否则会使用源码里写死的开发密钥，启动直接失败）：

```bash
HOST=0.0.0.0 \
NODE_ENV=production \
SESSION_SECRET="$(openssl rand -hex 32)" \
STUDENT_NO_PEPPER="$(openssl rand -hex 32)" \
PII_KEY="$(openssl rand -base64 32)" \
pnpm dev
```

注意 `pg_sid` Cookie 是 `Secure` 的，纯 HTTP 的局域网地址无法写入/回传登录态；真机联调要么走 HTTPS 隧道（如 Caddy/ngrok），要么用浏览器 devtools 的 secure context 方案。生产容器里由 `infra/docker-compose.yml` 显式设置 `HOST=0.0.0.0`，不需要改这里。

## 当前状态（2026-11-03）

- 开发文档 v1.1 已入库；契约门禁全绿。
- `#6`：monorepo（pnpm workspace + Node 24 原生 TS）、`apps/server` 骨架（`/health`）、`apps/worker` 骨架、`packages/contracts` 同步副本与 CI `workspace` job 已建。
- 引擎/接口/DB/seed 按 `12-分工与开发计划.md` 继续。
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
