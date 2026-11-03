import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import { checkPackage } from '../src/checks.ts';
import { publishPackage } from '../src/publish.ts';
import { writeDraftOutputs } from '../src/report.ts';
import { splitItems } from '../src/split.ts';
import { parsePageRange } from '../src/workspace.ts';

function seed(): ProblemPackage {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pg-import-'));
}

describe('导入 CLI（#36 / 10 §6）', () => {
  it('页码范围解析', () => {
    expect(parsePageRange('27-30,35')).toEqual([27, 28, 29, 30, 35]);
    expect(parsePageRange('7')).toEqual([7]);
    expect(() => parsePageRange('0-2')).toThrow();
    expect(() => parsePageRange('9-3')).toThrow();
  });

  it('按题目起始行切条目，并按章节 / 证明题过滤', () => {
    const pages = [
      {
        page: 27,
        text: '第二章 数列极限\n例1 证明 lim a_n = 3\n证明：取 ε>0。\n习题2 求下列极限。\n',
      },
    ];
    const all = splitItems(pages);
    expect(all).toHaveLength(2);
    expect(all[0]?.chapter).toContain('第二章');

    const proofs = splitItems(pages, { chapter: '2', proofOnly: true });
    expect(proofs).toHaveLength(1);
    expect(proofs[0]?.proofLike).toBe(true);
  });

  it('seed 题目包通过 S8 自动校验（Schema / KaTeX / 穷举泄题）', () => {
    const result = checkPackage(seed());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('两稿差异、透露量校准与校验结果写入 report.md', () => {
    const dir = tempDir();
    const a = seed();
    const b = structuredClone(a);
    b.public.title = `${b.public.title ?? ''}（B 稿）`;
    const item = {
      itemId: 'p27-i0',
      page: 27,
      chapter: '第二章 数列极限',
      label: '例1',
      body: '例1 证明 lim a_n = 3',
      proofLike: true,
    };
    const out = writeDraftOutputs(dir, item, a, b);
    expect(out.disagreements.length).toBeGreaterThan(0);
    expect(out.chosen).toBe('A');
    expect(existsSync(out.jsonPath)).toBe(true);
    const report = readFileSync(out.reportPath, 'utf8');
    expect(report).toContain('两稿分歧与仲裁理由');
    expect(report).toContain('题目标题不同');
    expect(report).toContain('自动校验（S8）');
  });

  it('import:publish 未配置 DATABASE_URL 时 dry-run（先跑门禁）', async () => {
    const dir = tempDir();
    const file = join(dir, 'epsN.json');
    writeFileSync(file, JSON.stringify(seed()));
    const result = await publishPackage(file, { reviewer: 'T-01', minutes: 90 });
    expect(result).toEqual({ ok: true, mode: 'dry-run', issues: [] });
  });
});
