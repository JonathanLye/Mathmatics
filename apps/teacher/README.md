# 教师端（apps/teacher，角色 C）

Vue 3 + Vite + TDesign Vue Next + ECharts。桌面优先；看板/详情手机可只读（04 开头）。前端只渲染服务端返回的数据，不实现层/预算/门槛/归类/闸门逻辑（12 §1）。

## 本地开发

```bash
# 1) 起 server（仓库根）
pnpm dev        # http://127.0.0.1:3000/health

# 2) 起教师端（另一个终端）
pnpm --filter @proof-gym/teacher dev   # http://localhost:5174，/api 代理到 3000
```

教师账号由运维创建（没有自助注册）：

```bash
TEACHER_PASSWORD='<至少 8 位密码>' node apps/server/src/db/cli.ts create-teacher lin.teacher
```

> 本地登录依赖 `pg_sid` Cookie（`Secure`）。Chrome 把 `http://localhost` 视为可信上下文，一般可用；若浏览器不保存 Cookie，改用 HTTPS 隧道（Caddy/ngrok），详见根 README 的“局域网/真机联调”。

## 验证命令

```bash
pnpm --filter @proof-gym/teacher typecheck   # vue-tsc
pnpm --filter @proof-gym/teacher test        # vitest（api client / redirect 纯逻辑）
pnpm --filter @proof-gym/teacher build       # vite build（产物在 dist/，按 05 §8 部署到 /t/）
```

## 已实现（#23 阶段）

- 登录、我的班级/建班、班级页（看板 / 名单 / 布置 / 指标 / 导出页签）
- 名单 CSV 导入（原始字节上传，服务端 UTF-8/GBK 探测）、邀请码重置
- 布置创建（`POST /teacher/assignments`）、5 秒轮询看板（`/live`）
- 暗色模式（`theme-mode`）、390/768/1280 基础响应式
- 依赖说明：`echarts` 固定 `^6.1.0`（CVE-2026-45249 修复版），留给 #35 的图表；`katex`/`ui-math` 暂未使用，已从依赖移除
- 部署：`vite.config.ts` 设 `base: '/t/'`，`router` 用 `BASE_URL`，对应 05 §8 的 `/t/` 静态文件约定

## #35 已实现

- 指标页：完成率/独立度中位数/首次求助前/提示后停留/自主覆盖率/连点/诚信提醒，层漏斗 + 关键步骤卡点（ECharts）；n<10 只显示计数，每个数字旁 ⓘ 显示 08 §4 口径。
- 学生详情抽屉（看板点行打开）：证明行（MathText）、提示、时间线、诚信信号与求助标记处理（忽略/已记录/已面谈）、解锁、发一句话（过闸门，被拦提示“未发送”）。
- 导出页：格式/表选择/匿名开关，POST /teacher/exports 并轮询状态；B 的 #32 未上线时显示“待上线”。

## 待接（依赖后续 issue）

- **班级/名单/邀请码/布置接口依赖 #50（PR #97）**；在 #97 合并前，main 上没有 `/teacher/*` 路由，页面会 404。合并后按 `README` 的 10 分钟流程联调并补截图。
- `/live`、`/teacher/attempts/{id}`、`/events`、`/flags`、`/nudge`、`/metrics` 属 **#51**；接口未上线时页面显示“待上线”，不伪造数据。
- 指标页、标记处理、解锁、导出页属 **#35**。
- 契约缺 `GET roster` / `GET /teacher/assignments` 列表 / `GET /teacher/classes/{id}`，见 #50 PR 的缺口清单；补齐前列表数据只能用创建返回值。

## E2E（教师端）

```bash
# 前置：API server（127.0.0.1:3000）+ 教师 dev（127.0.0.1:5174，/api 代理）
PG_TEACHER_USER=<测试教师> PG_TEACHER_PASSWORD=<密码> pnpm --filter @proof-gym/teacher e2e:teacher
```

覆盖：登录 → 建班/名单/布置（浏览器 Cookie 复用）→ 学生作答（独立 request context）→ 看板 →
学生详情 → 指标 → 导出 → 题库/审核 → 390/768/1280 → 深色；断言无 pageerror、关键数据一致。
截图与 results.json 在 `tests/.artifacts/e2e-teacher/`（gitignore，不入库）。
`PG_CHROMIUM` 可指定 Chromium/headless-shell 可执行文件路径。
