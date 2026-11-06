# apps/import · 题库导入流水线 CLI（#36 / 10 §6，角色 C）

## 批量导入（练习区题库，U16，10 §6.1）

```bash
# 只放软链的目录指向教辅 PDF：PDF 不进仓库，imports/ 已 gitignore
pnpm import:batch imports/batch-v3/sources --out imports/batch-v3 --dry-run

# 试跑 20 题（校验量默认是 3 倍），读一遍输出再放大
node --env-file=infra/.env apps/import/src/cli.ts batch imports/batch-v3/sources --out imports/batch-v3 --resume --max 20 --concurrency 8 --budget-cny 150

# 全量。--stages 可以只跑其中几步：ocr,segment,candidates,verify,draft,variation,bundle
node --env-file=infra/.env apps/import/src/cli.ts batch imports/batch-v3/sources --out imports/batch-v3 --resume --max 500 --concurrency 8 --budget-cny 150

# 只重新打包，不调模型
pnpm import:bundle --out imports/batch-v3

# 发布（在服务器的一次性容器里跑，先确认 0006 迁移已执行）
ssh bolimc-prod 'cd /var/www/proofgym && docker compose -p proofgym run -T --rm server node apps/server/src/db/cli.ts import-bundle' < imports/batch-v3/bundle.jsonl.gz
```

产物都在 `--out` 下：

| 文件 | 内容 |
|---|---|
| `manifest.json` | 每个文件、每页、每题的状态、成本与原因 |
| `costs.jsonl`、`costs-summary.json` | 每次模型调用的实际用量与费用；累计达到 `--budget-cny` 就停止 |
| `progress.log` | 进度日志 |
| `ocr/<book>/page-NNNN.md` | 每页 OCR，有缓存的页不再花钱 |
| `segments/`、`items/`、`candidates.json` | 切分窗口、条目、过滤后的候选 |
| `norm/`、`verify/`、`drafts/`、`variation/` | 每题一个文件的缓存 |
| `bundle.jsonl.gz` | 发布用：头一行、单元、题 |
| `failed.json`、`report.json` | 失败清单（带原因）；漏斗、分章分档统计、变式测试、费用 |

**模型**：文本阶段（切分、整理、校验、修补、起草、变式测试）全部用 `deepseek-flash`，第二模型核验暂停（owner 决定）。`manifest.json` 每题记录 `writtenBy` 和 `checkedBy`，以后要补查可以按它筛。账户欠费或余额不足时整轮停下，已有结果不丢。

没通过校验或门禁的题只进 `failed.json`，不发布，也不进人工队列。发布工具 `import-bundle` 在 `apps/server/src/db/import-bundle.ts`，只用服务端镜像里已有的依赖。

**导入题的形状**：只开 L3（写证明）和 L6（总结）；只有一条路线，因为引擎的 `nextKey` 要求每条路线都走完才算闭合，别的证法写进模式里；`secret.walkthrough` 必填。

## 单题导入（教师手工，10 §6）

```bash
# 0) 仓库内自带最小 fixtures（离线可复现）
#    fixtures/ch2/page-027.md       OCR 页面（例1 证明题 + 习题2 计算题）
#    fixtures/epsN.json             A 稿（取自项目的 epsN seed）
#    fixtures/epsN-alt.json         B 稿（仅标题不同，用于演示仲裁与分歧）

# 1) 登记 + 渲染 + OCR（离线 fixture；真实 OCR 用 --ocr-provider simpletex|qwen，见下）
pnpm import:pdf --file /tmp/fake.pdf --pages 27-28 --skip-render --ocr-fixture apps/import/fixtures/ch2
# 0) 或一条龙：登记/渲染/OCR → 切条目 → 起草/仲裁/校验（--submit 时再暂存 DB）
pnpm import:run --file /tmp/fake.pdf --pages 27-28 --skip-render \
  --ocr-fixture apps/import/fixtures/ch2 --max 4 \
  --draft-fixture-a apps/import/fixtures/epsN.json --draft-fixture-b apps/import/fixtures/epsN-alt.json

# 2) 切条目（按章节 / 只要证明题）
pnpm import:items --job <jobId> --chapter 2 --proof-only
# 3) 两稿起草 + 仲裁 + 校验 → imports/<jobId>/<problemId>.json、<problemId>.report.md、job 级 report.md
pnpm import:draft --job <jobId> --max 4 \
  --draft-fixture-a apps/import/fixtures/epsN.json --draft-fixture-b apps/import/fixtures/epsN-alt.json
# 4) 发布（先跑 S8；DATABASE_URL 设置后才写库，否则 dry-run）
pnpm import:publish imports/<jobId>/epsN.json --reviewer T-01 --minutes 90
#    或先暂存为草稿，交给教师审核屏 approve/return（推荐流程）
pnpm import:submit imports/<jobId>/epsN.json --database-url postgres://… --concepts apps/import/fixtures/concepts.json
```

## 说明

- 产物在 `imports/`（已 gitignore）：教辅 PDF 不入库；页面图与 OCR 全文只留在本地/服务器（10 §7）。
- `import:pdf` 的 OCR：
  - 离线：`--ocr-fixture`（`page-027.md`）；
  - 真实：`--ocr-provider simpletex`（需 `SIMPLETEX_API_KEY`，通用 OCR 端点 `<dir>/pages/page-*.png`）或
    `--ocr-provider qwen`（需 `DASHSCOPE_API_KEY`，DashScope OpenAI 兼容，`QWEN_VL_MODEL` 可覆盖）；
  - 真实 OCR 必须渲染页面（不能 `--skip-render`）。**未用真实 key 验证**：响应形状/SDK 字段以官方文档为准，
    适配器可注入 `fetch`，测试用 mock 覆盖请求形状与错误路径（`test/providers.test.ts`）。
- `import:draft` 的模型：配置 `DEEPSEEK_API_KEY` 时双温度调用 DeepSeek 起草；若同时配置 `DASHSCOPE_API_KEY`，
  A 稿走 DeepSeek、B 稿走 Qwen（`QWEN_DRAFT_MODEL`，默认 qwen-plus），即 10 §2 S7 的**双模型起草**；
  `response_format: json_object` + prompt 含 json；离线用 `--draft-fixture-a/b`（单包 / 数组 / `{items:{...}}`）。
- **多条目**：每条目写 `<problemId>.report.md`；同一题号复用时 JSON 自动加 `-<itemId>` 后缀；job 级 `report.md` 汇总全部条目与校验结果（不会互相覆盖）。
- S8 自动校验：JSON Schema（contracts 的 problem-package.schema.json）、KaTeX、穷举泄题（复用 `packages/engine` 的 `leakExhaustive`；单包模式不传概念库，概念/词条泄漏由 seed 检查覆盖）。schema 不通过时不写 JSON，只写报告列出问题。
- 安全：模型输出的 `id` 只接受 Slug，非法值退化为 `item-<itemId>`，并校验输出路径必须落在 `imports/` 内（防路径穿越）。
- `import:publish` 设 `DATABASE_URL` 时写 `content.problems / content.problem_versions / vault.problem_secrets / vault.reference_proofs / content.review_records`；`--reviewer` 是教师匿名码（app.users.anon_code）。同一 version 已发布：内容相同→幂等跳过，内容不同→要求 bump version（07 published 不可变）。

## 草稿暂存（`import:submit`）

- 写入 `content.problems` + `content.problem_versions(review_status='draft', auto_checks=四类布尔)` +
  `vault.problem_secrets` + `vault.reference_proofs`；
- 版本规则：包自带 version 大于当前最大版本则沿用，否则顺延 `max+1`（已发布版本不可覆盖）；
- 教师审核屏「通过」要求四类 auto_checks 全绿（由本命令的 S8 结果写入），通过后服务端切 `current_version`；
- 未设置 `--database-url`/`DATABASE_URL` 时为 dry-run，只输出四项校验结果。
