import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import type { ProblemPackage } from '@proof-gym/engine';

import { checkPackage, type CheckIssue, type CheckOptions } from './checks.ts';
import type { ImportItem } from './split.ts';

export interface DraftOutput {
  problemId: string;
  jsonPath: string;
  reportPath: string;
  chosen: 'A' | 'B';
  ok: boolean;
  jsonWritten: boolean;
  disagreements: string[];
  revealMismatches: string[];
  checksA: CheckIssue[];
  checksB: CheckIssue[];
}

const SLUG = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const SKIP = new Set(['patterns', 'leak', 'triggers', 'expr', 'jev', 'label', 'code', 'map', 'file', 'id']);

// 模型输出是不可信输入：id 只接受 schema 的 Slug；否则退化为 item-<itemId>（A 复审 P2-2）。
function safeSlug(pkg: ProblemPackage, itemId: string): string {
  const id = typeof pkg.id === 'string' ? pkg.id : '';
  if (SLUG.test(id) && !id.includes('..')) return id;
  return `item-${itemId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function inside(dir: string, file: string): boolean {
  return resolve(file).startsWith(resolve(dir) + sep);
}

function keyMaxCost(pkg: ProblemPackage, keyId: string): number {
  const keys = Array.isArray(pkg?.secret?.keys) ? pkg.secret.keys : [];
  const key = keys.find((item) => item.id === keyId);
  if (!key) return 0;
  return key.hints.reduce((max, hint) => Math.max(max, Number(hint.cost)), 0);
}

function walkStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.forEach((item) => walkStrings(item, visit));
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!SKIP.has(key)) walkStrings(item, visit);
    }
  }
}

export function compareDrafts(a: ProblemPackage, b: ProblemPackage): { disagreements: string[]; revealMismatches: string[] } {
  const disagreements: string[] = [];
  const revealMismatches: string[] = [];

  const titleA = typeof a?.public?.title === 'string' ? a.public.title : '';
  const titleB = typeof b?.public?.title === 'string' ? b.public.title : '';
  if (titleA !== titleB) disagreements.push(`题目标题不同：A="${titleA}" B="${titleB}"`);

  const keysA = (a?.secret?.keys ?? []).map((key) => key.id).join(',');
  const keysB = (b?.secret?.keys ?? []).map((key) => key.id).join(',');
  if (keysA !== keysB) disagreements.push(`关键步骤集合不同：A=[${keysA}] B=[${keysB}]`);

  const routesA = JSON.stringify(a?.secret?.routes ?? []);
  const routesB = JSON.stringify(b?.secret?.routes ?? []);
  if (routesA !== routesB) disagreements.push(`路线不同：A=${routesA} B=${routesB}`);

  for (const keyId of new Set([...(a?.secret?.keys ?? []).map((k) => k.id), ...(b?.secret?.keys ?? []).map((k) => k.id)])) {
    const costA = keyMaxCost(a, keyId);
    const costB = keyMaxCost(b, keyId);
    if (costA !== costB) revealMismatches.push(`${keyId}：A 最高透露 ${costA} vs B ${costB}`);
  }

  return { disagreements, revealMismatches };
}

// DoD：每条目输出 `<problemId>.json` 与报告；多条目不互相覆盖（A 复审 P1-1）。
export function writeDraftOutputs(
  jobDir: string,
  item: ImportItem,
  a: ProblemPackage,
  b: ProblemPackage,
  options: CheckOptions = {},
): DraftOutput {
  const checksA = checkPackage(a, options);
  const checksB = checkPackage(b, options);
  const { disagreements, revealMismatches } = compareDrafts(a, b);

  let chosen: 'A' | 'B' = 'A';
  let reason = '两稿都通过自动校验；按“双模型起草 + 仲裁”默认取 A 稿，交教师审核时再逐条对照 B。';
  if (!checksA.ok && checksB.ok) {
    chosen = 'B';
    reason = 'A 稿未通过自动校验、B 稿通过，按仲裁规则取 B。';
  } else if (checksA.ok && !checksB.ok) {
    chosen = 'A';
    reason = 'A 稿通过自动校验、B 稿未通过，取 A。';
  } else if (!checksA.ok && !checksB.ok) {
    reason = '两稿都未通过自动校验；默认保留 A 稿，report 列出全部问题，需人工修正后重跑 S8。';
  }

  const pkg = chosen === 'A' ? a : b;
  const schemaOk = checksA.ok || checksB.ok;
  const baseId = safeSlug(pkg, item.itemId);

  let jsonPath = join(jobDir, `${baseId}.json`);
  // 同一题号被多个条目复用时加 item 后缀，避免覆盖（A 复审 P1-1）。
  if (existsSync(jsonPath)) jsonPath = join(jobDir, `${baseId}-${item.itemId}.json`);
  let reportPath = join(jobDir, `${baseId}.report.md`);
  // 同一题号复用时报告也加后缀，否则后一个条目覆盖前一个（A 复审 P1-1）。
  if (existsSync(reportPath)) reportPath = join(jobDir, `${baseId}-${item.itemId}.report.md`);
  if (!inside(jobDir, jsonPath) || !inside(jobDir, reportPath)) {
    throw new Error('输出路径越界（拒绝写入 imports/ 之外）');
  }

  const jsonWritten = schemaOk;
  if (jsonWritten) writeFileSync(jsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const lines: string[] = [
    `# 导入草稿报告 · ${baseId}`,
    '',
    `- 条目：${item.itemId}（第 ${item.page} 页${item.chapter === '' ? '' : `，${item.chapter}`}）`,
    `- 采用稿：${chosen}`,
    `- 仲裁理由：${reason}`,
    `- JSON：${jsonWritten ? jsonPath : '未写入（schema 未通过，先修 report 里的问题）'}`,
    '',
    '## 两稿分歧与仲裁理由',
    '',
    disagreements.length === 0 ? '- 无结构性分歧。' : disagreements.map((entry) => `- ${entry}`).join('\n'),
    '',
    '## 透露量校准不一致的提示',
    '',
    revealMismatches.length === 0 ? '- 无。' : revealMismatches.map((entry) => `- ${entry}`).join('\n'),
    '',
    '## 自动校验（S8）',
    '',
    '### A 稿',
    '',
    checksA.ok ? '- ✅ 全部通过（Schema / KaTeX / 穷举泄题）' : checksA.issues.map((issue) => `- ❌ ${issue.where}：${issue.message}`).join('\n'),
    '',
    '### B 稿',
    '',
    checksB.ok ? '- ✅ 全部通过（Schema / KaTeX / 穷举泄题）' : checksB.issues.map((issue) => `- ❌ ${issue.where}：${issue.message}`).join('\n'),
    '',
    '## 下一步',
    '',
    '- 教师在编辑器里修正 JSON 后执行 `pnpm import:publish <file> --reviewer <匿名码> --minutes <n>`。',
    '- 本报告只针对导入草稿；发布前 S8 会再跑一遍。',
  ];
  writeFileSync(reportPath, `${lines.join('\n')}\n`);

  return {
    problemId: baseId,
    jsonPath,
    reportPath,
    chosen,
    ok: jsonWritten,
    jsonWritten,
    disagreements,
    revealMismatches,
    checksA: checksA.ok ? [] : checksA.issues,
    checksB: checksB.ok ? [] : checksB.issues,
  };
}

// job 级聚合报告：多条目时索引到各自的 report（A 复审 P1-1）。
export function writeJobReport(jobDir: string, outputs: DraftOutput[]): string {
  const path = join(jobDir, 'report.md');
  if (!inside(jobDir, path)) throw new Error('报告路径越界');
  const lines = [
    `# 导入任务报告（${outputs.length} 个条目）`,
    '',
    '| itemId | problemId | 采用稿 | S8 | 草稿 JSON | 单条报告 |',
    '|---|---|---|---|---|---|',
    ...outputs.map(
      (out) =>
        `| ${out.problemId} | ${out.problemId} | ${out.chosen} | ${out.ok ? '✅' : '❌'} | ${out.jsonWritten ? '已写入' : '未写入'} | ${out.reportPath} |`,
    ),
    '',
    '## 自动校验摘要',
    '',
    ...outputs.map((out) => {
      const failures = [...out.checksA, ...out.checksB];
      return `- ${out.problemId}：${out.ok ? '通过' : `未通过（${failures.length} 条问题，见单条报告）`}`;
    }),
    '',
  ];
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}
