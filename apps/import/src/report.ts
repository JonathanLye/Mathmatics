import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProblemPackage } from '@proof-gym/engine';

import { checkPackage, type CheckIssue } from './checks.ts';
import type { ImportItem } from './split.ts';

export interface DraftOutput {
  problemId: string;
  jsonPath: string;
  reportPath: string;
  chosen: 'A' | 'B';
  ok: boolean;
  disagreements: string[];
  revealMismatches: string[];
  checksA: CheckIssue[];
  checksB: CheckIssue[];
}

function keyMaxCost(pkg: ProblemPackage, keyId: string): number {
  const key = pkg.secret.keys.find((item) => item.id === keyId);
  if (!key) return 0;
  return key.hints.reduce((max, hint) => Math.max(max, Number(hint.cost)), 0);
}

export function compareDrafts(a: ProblemPackage, b: ProblemPackage): { disagreements: string[]; revealMismatches: string[] } {
  const disagreements: string[] = [];
  const revealMismatches: string[] = [];

  if (a.public.title !== b.public.title) disagreements.push(`题目标题不同：A="${a.public.title ?? ''}" B="${b.public.title ?? ''}"`);
  if (Number(a.public.keyCount ?? a.secret.keys.length) !== Number(b.public.keyCount ?? b.secret.keys.length)) {
    disagreements.push('题目包 keyCount 不同');
  }

  const keysA = a.secret.keys.map((key) => key.id).join(',');
  const keysB = b.secret.keys.map((key) => key.id).join(',');
  if (keysA !== keysB) disagreements.push(`关键步骤集合不同：A=[${keysA}] B=[${keysB}]`);

  const routesA = JSON.stringify(a.secret.routes ?? []);
  const routesB = JSON.stringify(b.secret.routes ?? []);
  if (routesA !== routesB) disagreements.push(`路线不同：A=${routesA} B=${routesB}`);

  for (const keyId of new Set([...a.secret.keys.map((k) => k.id), ...b.secret.keys.map((k) => k.id)])) {
    const costA = keyMaxCost(a, keyId);
    const costB = keyMaxCost(b, keyId);
    if (costA !== costB) revealMismatches.push(`${keyId}：A 最高透露 ${costA} vs B ${costB}`);
  }

  return { disagreements, revealMismatches };
}

export function writeDraftOutputs(jobDir: string, item: ImportItem, a: ProblemPackage, b: ProblemPackage): DraftOutput {
  const checksA = checkPackage(a);
  const checksB = checkPackage(b);
  const { disagreements, revealMismatches } = compareDrafts(a, b);

  // 仲裁规则（P1 简化）：优先选通过自动校验的稿；都通过或都不通过时默认 A，并在 report 写明理由。
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
  const problemId = String(pkg.id ?? item.itemId);
  const jsonPath = join(jobDir, `${problemId}.json`);
  const reportPath = join(jobDir, 'report.md');

  writeFileSync(jsonPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const lines: string[] = [
    `# 导入草稿报告 · ${problemId}`,
    '',
    `- 条目：${item.itemId}（第 ${item.page} 页${item.chapter === '' ? '' : `，${item.chapter}`}）`,
    `- 采用稿：${chosen}`,
    `- 仲裁理由：${reason}`,
    '',
    '## 两稿分歧与仲裁理由',
    '',
    disagreements.length === 0 ? '- 无结构性分歧。' : disagreements.map((item) => `- ${item}`).join('\n'),
    '',
    '## 透露量校准不一致的提示',
    '',
    revealMismatches.length === 0 ? '- 无。' : revealMismatches.map((item) => `- ${item}`).join('\n'),
    '',
    '## 自动校验（S8）',
    '',
    '### A 稿',
    '',
    checksA.ok ? '- ✅ 全部通过（Schema / KaTeX / 穷举泄题 / 透露量）' : checksA.issues.map((issue) => `- ❌ ${issue.where}：${issue.message}`).join('\n'),
    '',
    '### B 稿',
    '',
    checksB.ok ? '- ✅ 全部通过（Schema / KaTeX / 穷举泄题 / 透露量）' : checksB.issues.map((issue) => `- ❌ ${issue.where}：${issue.message}`).join('\n'),
    '',
    '## 下一步',
    '',
    '- 教师在编辑器里修正 JSON 后执行 `pnpm import:publish <file> --reviewer <匿名码> --minutes <n>`。',
    '- 本报告只针对导入草稿；发布前 S8 会再跑一遍。',
  ];
  writeFileSync(reportPath, `${lines.join('\n')}\n`);

  return {
    problemId,
    jsonPath,
    reportPath,
    chosen,
    ok: (chosen === 'A' ? checksA.ok : checksB.ok),
    disagreements,
    revealMismatches,
    checksA: checksA.issues,
    checksB: checksB.issues,
  };
}
