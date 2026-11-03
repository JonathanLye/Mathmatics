# apps/import · 题库导入流水线 CLI（#36 / 10 §6，角色 C）

```bash
# 1) 登记 + 渲染 + OCR（离线用 fixture；真实 SimpleTex/Qwen 属 P1）
pnpm import:pdf --file "华东师大版数学分析答案（上下册）.pdf" --pages 27-58 --ocr-fixture fixtures/ch2
# 2) 切条目（按章节 / 只要证明题）
pnpm import:items --job <jobId> --chapter 2 --proof-only
# 3) 两稿起草 + 仲裁 + 校验 → imports/<jobId>/<problemId>.json + report.md
pnpm import:draft --job <jobId> --items p27-i0,p27-i1 --max 4 \
  --draft-fixture-a fixtures/epsN.json --draft-fixture-b fixtures/epsN-alt.json
# 4) 发布（先跑 S8；DATABASE_URL 设置后才写库，否则 dry-run）
pnpm import:publish imports/<jobId>/epsN.json --reviewer T-01 --minutes 90
```

## 说明

- 产物在 `imports/`（已 gitignore）：教辅 PDF 不入库；页面图与 OCR 全文只留在本地/服务器（10 §7）。
- `import:pdf` 的 OCR：P0 CLI 用 `--ocr-fixture`（`page-027.md`）；SimpleTex/Qwen 真实 provider 与队列属 P1（10 §2 S3）。
- `import:draft` 的模型：配置 `DEEPSEEK_API_KEY` 时双温度调用 DeepSeek 起草；离线用 `--draft-fixture-a/b`（单包 / 数组 / `{items:{...}}`）。
- S8 自动校验：JSON Schema（contracts 的 problem-package.schema.json）、KaTeX、穷举泄题（复用 `packages/engine` 的 `leakExhaustive`）；透露量校准在两稿比对里提示。
- `import:publish` 设 `DATABASE_URL` 时写 `content.problems / content.problem_versions / vault.problem_secrets / vault.reference_proofs / content.review_records`；`--reviewer` 是教师匿名码（app.users.anon_code）。
