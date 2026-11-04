# apps/import · 题库导入流水线 CLI（#36 / 10 §6，角色 C）

```bash
# 0) 仓库内自带最小 fixtures（离线可复现）
#    fixtures/ch2/page-027.md       OCR 页面（例1 证明题 + 习题2 计算题）
#    fixtures/epsN.json             A 稿（取自项目的 epsN seed）
#    fixtures/epsN-alt.json         B 稿（仅标题不同，用于演示仲裁与分歧）

# 1) 登记 + 渲染 + OCR（离线 fixture；真实 OCR 用 --ocr-provider simpletex|qwen，见下）
pnpm import:pdf --file /tmp/fake.pdf --pages 27-28 --skip-render --ocr-fixture apps/import/fixtures/ch2
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
- `import:draft` 的模型：配置 `DEEPSEEK_API_KEY` 时双温度调用 DeepSeek 起草（同一模型、非 10 §2 S6 的“双模型”，P1 provider issue 跟进）；
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
