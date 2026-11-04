import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import { checkCategories, checkPackage } from '../src/checks.ts';
import { publishPackage } from '../src/publish.ts';
import { arbitrateDrafts, revealTotal, writeDraftOutputs } from '../src/report.ts';
import { splitItems } from '../src/split.ts';
import { parsePageRange } from '../src/workspace.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

function seed(): ProblemPackage {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pg-import-'));
}

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, IMPORT_ROOT: join(cwd, 'imports') },
  });
}

const ITEM = {
  itemId: 'p27-i0',
  page: 27,
  chapter: '第二章 数列极限',
  label: '例1',
  body: '例1 证明 lim a_n = 3',
  proofLike: true,
};

describe('导入 CLI（#36 / 10 §6）', () => {
  it('页码范围解析与上限', () => {
    expect(parsePageRange('27-30,35')).toEqual([27, 28, 29, 30, 35]);
    expect(parsePageRange('7')).toEqual([7]);
    expect(() => parsePageRange('0-2')).toThrow();
    expect(() => parsePageRange('9-3')).toThrow();
    expect(() => parsePageRange('1-2001')).toThrow();
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

  it('S8 四项布尔与审核门禁一致（#128 approve 要求）', () => {
    const result = checkCategories(seed());
    expect(result.categories).toEqual({
      schema: true,
      katex: true,
      leakExhaustive: true,
      patternSelfTest: true,
    });
  });

  it('S8 结构与提示阶梯：H0..H4 / 透露量 / keyCount / 正则 / 规则自测', () => {
    // H0..H4 / 透露量由 schema 枚举保证（schema 不通过会先行返回）；这里测 schema 之外的规则。
    const badRoute = seed();
    badRoute.secret.routes[0] = ['NOPE'];
    expect(checkPackage(badRoute).issues.some((issue) => issue.message.includes('路线引用了不存在'))).toBe(true);

    const badKeyCount = seed();
    badKeyCount.public.keyCount = badKeyCount.public.keyCount + 1;
    expect(checkPackage(badKeyCount).issues.some((issue) => issue.message.includes('keyCount'))).toBe(true);

    const badRegex = seed();
    badRegex.secret.keys[0]!.patterns = ['('];
    expect(checkPackage(badRegex).issues.some((issue) => issue.message.includes('正则不合法'))).toBe(true);

    const badExample = seed();
    badExample.secret.keys[0]!.examples = ['完全无关的文本'];
    expect(checkPackage(badExample).issues.some((issue) => issue.message.includes('样例未命中'))).toBe(true);
  });

  it('S7 仲裁评分：校验问题/透露量/路线透明计分，同分默认 A', () => {
    const a = seed();
    const b = seed();
    const tie = arbitrateDrafts(a, b, [], []);
    expect(tie.chosen).toBe('A');
    expect(tie.reasons.join(' ')).toContain('透露量');
    expect(tie.reasons.join(' ')).toContain('校验问题');

    const bWins = arbitrateDrafts(a, b, [{ where: 'x', message: '坏' }], []);
    expect(bWins.chosen).toBe('B');
    expect(bWins.scoreB).toBeGreaterThan(bWins.scoreA);
    expect(revealTotal(a)).toBeGreaterThan(0);
  });

  it('S8 概念库/词条也做穷举泄题检查（--concepts）', () => {
    const leak = seed().secret.keys[0]!.leak[0] as string;
    const concepts = { concepts: [], glossary: [{ id: 'g1', answer: `提示：${leak}` }] };
    const result = checkPackage(seed(), { concepts });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.where === 'glossary.g1')).toBe(true);
  });

  it('畸形包不崩溃：schema 先失败并返回问题', () => {
    expect(() => checkPackage({} as ProblemPackage)).not.toThrow();
    expect(checkPackage({} as ProblemPackage).ok).toBe(false);
  });

  it('两稿差异写入单条报告，不写越界路径', () => {
    const dir = tempDir();
    const a = seed();
    const b = structuredClone(a);
    b.public.title = `${b.public.title ?? ''}（B 稿）`;
    const out = writeDraftOutputs(dir, ITEM, a, b);
    expect(out.disagreements.length).toBeGreaterThan(0);
    expect(out.chosen).toBe('A');
    expect(out.jsonWritten).toBe(true);
    const report = readFileSync(out.reportPath, 'utf8');
    expect(report).toContain('两稿分歧与仲裁理由');
    expect(report).toContain('题目标题不同');
    expect(report).toContain('自动校验（S8）');
  });

  it('非法 id 退化为安全文件名，不产生路径穿越', () => {
    const dir = tempDir();
    const a = seed();
    a.id = '../../evil';
    const out = writeDraftOutputs(dir, ITEM, a, structuredClone(a));
    expect(out.problemId.startsWith('item-')).toBe(true);
    expect(out.jsonWritten).toBe(false); // schema 不通过：只写报告，不写 JSON
    expect(out.reportPath.startsWith(dir)).toBe(true);
    expect(existsSync(join(dir, '..', '..', 'evil.json'))).toBe(false);
  });

  it('import:publish 未配置 / 空 DATABASE_URL 时 dry-run', async () => {
    const dir = tempDir();
    const file = join(dir, 'epsN.json');
    writeFileSync(file, JSON.stringify(seed()));
    expect(await publishPackage(file, { reviewer: 'T-01', minutes: 90 })).toEqual({ ok: true, mode: 'dry-run', issues: [] });
    expect(await publishPackage(file, { reviewer: 'T-01', minutes: 90, databaseUrl: '' })).toEqual({
      ok: true,
      mode: 'dry-run',
      issues: [],
    });
  });

  it(
    '四条命令在仓库 fixtures 下端到端跑通（多条目报告不覆盖）',
    () => {
      const root = tempDir();
      const pdf = join(root, 'fake.pdf');
      writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');

      let res = runCli(root, [
        'pdf',
        '--file',
        pdf,
        '--pages',
        '27-28',
        '--skip-render',
        '--ocr-fixture',
        join(FIXTURES, 'ch2'),
        '--job',
        'e2e',
      ]);
      expect(res.status, res.stderr).toBe(0);

      res = runCli(root, ['items', '--job', 'e2e']);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain('条目 2 个');

      // CLI 参数校验：非法 jobId / --max 非整数都要退出非 0 且信息明确
      const badJob = runCli(root, ['items', '--job', '../escape']);
      expect(badJob.status).toBe(1);
      expect(badJob.stderr).toContain('jobId 不合法');
      const badMax = runCli(root, ['draft', '--job', 'e2e', '--max', 'abc']);
      expect(badMax.status).toBe(1);
      expect(badMax.stderr).toContain('--max');

      res = runCli(root, [
        'draft',
        '--job',
        'e2e',
        '--max',
        '2',
        '--draft-fixture-a',
        join(FIXTURES, 'epsN.json'),
        '--draft-fixture-b',
        join(FIXTURES, 'epsN-alt.json'),
      ]);
      expect(res.status, res.stderr).toBe(0);

      const jobDir = join(root, 'imports', 'e2e');
      expect(existsSync(join(jobDir, 'report.md'))).toBe(true);
      const jobReport = readFileSync(join(jobDir, 'report.md'), 'utf8');
      expect(jobReport).toContain('导入任务报告（2 个条目）');

      const files = readdirSync(jobDir);
      expect(files).toContain('epsN.json');
      expect(files).toContain('epsN.report.md');
      // 第二条目同题号：JSON 与单条报告都加 itemId 后缀，不覆盖第一条。
      expect(files.some((name) => /^epsN-p\d+-i\d+\.json$/.test(name))).toBe(true);
      expect(files.some((name) => /^epsN-p\d+-i\d+\.report\.md$/.test(name))).toBe(true);

      res = runCli(root, ['publish', join(jobDir, 'epsN.json'), '--reviewer', 'T-01', '--minutes', '90']);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain('"mode": "dry-run"');
    },
    30_000,
  );
});
