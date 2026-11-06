import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runImportGates } from '@proof-gym/content-checks';
import { canon, createAttempt, step, type ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import { buildBundle, contentHash, decodeBundle, encodeBundle, type BundleLine } from '../src/batch/bundle.ts';
import { assemblePackage, categorize, DRAFT_MODEL, draftPart, fixPattern, fragmentCanon, problemIdFor, type DraftOutcome } from '../src/batch/draft-stage.ts';
import { BudgetExceededError, CostLedger, costOf, isDeepSeekPeak } from '../src/batch/ledger.ts';
import { AccountBlockedError, createChatClient, parseJsonLoose, providerOf } from '../src/batch/llm.ts';
import { runBatch, type BatchOptions } from '../src/batch/run.ts';
import { SEGMENT_MODEL, type SegmentedItem } from '../src/batch/segment.ts';
import { selectForDraft, spreadByChapter } from '../src/batch/select.ts';
import { sampleForVariation, VARIATION_MODEL } from '../src/batch/variation.ts';
import { bandOf, NORMALIZE_MODEL, REPAIR_MODEL, VERIFY_MODEL, verifyPart, type VerifiedPart } from '../src/batch/verify.ts';
import { draftFor, solutionFor, stemFor, stubClient, type StubClient } from './batch-fixtures.ts';

const CONCEPTS = { concepts: [{ id: 'seq-limit', title: '数列极限' }], glossary: [] };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pg-batch-'));
}

function book(letters: string[]): string {
  const lines = ['[页眉] 第二章 数列极限', '§1 数列极限概念'];
  letters.forEach((letter, index) => {
    lines.push(`${index + 1}. ${stemFor(letter)}`, `证 ${solutionFor(letter)}`);
  });
  return lines.join('\n');
}

function setup(letters: string[], extra: string[] = []): { dir: string; out: string } {
  const root = tempDir();
  const dir = join(root, 'sources');
  mkdirSync(dir);
  writeFileSync(join(dir, 'bookone.md'), [book(letters), ...extra].join('\n'));
  return { dir, out: join(root, 'out') };
}

function options(dir: string, out: string, client: StubClient, more: Partial<BatchOptions> = {}): BatchOptions {
  return {
    dir,
    out,
    dryRun: false,
    resume: false,
    concurrency: 2,
    budgetCny: 150,
    stages: ['ocr', 'segment', 'candidates', 'verify', 'draft', 'variation', 'bundle'],
    useSegmentModel: false,
    client,
    concepts: CONCEPTS as never,
    ...more,
  };
}

function readBundle(out: string): BundleLine[] {
  return decodeBundle(readFileSync(join(out, 'bundle.jsonl.gz')));
}

function problems(lines: BundleLine[]): Extract<BundleLine, { type: 'problem' }>[] {
  return lines.filter((line): line is Extract<BundleLine, { type: 'problem' }> => line.type === 'problem');
}

function readFailed(out: string): Array<{ id: string; stage: string; reason: string }> {
  return JSON.parse(readFileSync(join(out, 'failed.json'), 'utf8')) as Array<{ id: string; stage: string; reason: string }>;
}

describe('批量流水线（打桩）', () => {
  it('dry-run 列出文件、页数和估算，不调模型', async () => {
    const { dir, out } = setup(['a']);
    writeFileSync(join(dir, 'scan.png'), Buffer.from([0x89]));
    writeFileSync(join(dir, 'doc.pdf'), Buffer.from([0x25]));
    writeFileSync(join(dir, 'locked.pdf'), Buffer.from([0x25]));
    const client = stubClient();
    const result = await runBatch(
      options(dir, out, client, {
        dryRun: true,
        probe: (file) => (file.includes('locked') ? { pages: 0, error: '受密码保护，已跳过（不尝试绕过）' } : { pages: 10 }),
      }),
    );
    expect(client.calls).toHaveLength(0);
    expect(existsSync(join(out, 'manifest.json'))).toBe(false);
    expect(result.dryRun?.ocrPages).toBe(11);
    expect(result.dryRun?.estimatedOcrCny).toBeGreaterThan(0);
    expect(result.dryRun?.files.find((file) => file.relPath === 'locked.pdf')?.skipped).toContain('密码');
  });

  it('全流程：候选、校验、起草、门禁、打包；非证明题与依赖别题的不进题库', async () => {
    const { dir, out } = setup(['a', 'b'], [
      '3. 求 $\\lim_{n\\to\\infty}\\frac{n+1}{n}$。',
      `解 ${solutionFor('z')}`,
      `4. 如上题，证明结论对 $x$ 也成立。`,
      `证 ${solutionFor('y')}`,
    ]);
    const client = stubClient();
    const result = await runBatch(options(dir, out, client));
    expect(result.budgetStopped).toBe(false);
    const bundle = readBundle(out);
    const ready = problems(bundle);
    expect(ready.map((line) => line.pkg.id).sort()).toEqual(['imp-bookone-c02-s01-e1', 'imp-bookone-c02-s01-e2']);
    const failed = readFailed(out);
    expect(failed.find((entry) => entry.reason === 'refers_other')).toBeDefined();
    const pkg = ready[0]?.pkg as ProblemPackage;
    // 导入题只开 L3 与 L6；不存在的概念被去掉；结构字段由工具组装。
    expect(pkg.public.layers.L1.enabled).toBe(false);
    expect(pkg.public.layers.L3.enabled).toBe(true);
    expect(pkg.public.layers.L5.enabled).toBe(false);
    expect(pkg.public.layers.L6.enabled).toBe(true);
    expect(pkg.public.concepts).toEqual(['seq-limit']);
    expect(pkg.public.keyCount).toBe(3);
    expect(pkg.secret.walkthrough?.keyIdeas.length).toBeGreaterThan(0);
    expect(pkg.secret.keys[0]?.hints.map((hint) => hint.cost)).toEqual([0, 0, 0.5, 1, 1]);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { funnel: { ready: number }; readyByBand: Record<string, number> };
    expect(report.funnel.ready).toBe(2);
    expect(report.readyByBand.easy).toBe(2);
  });

  it('manifest 记录每题谁写、谁查；报告按起草模型分开统计通过率', async () => {
    const { dir, out } = setup(['a', 'b']);
    const client = stubClient({
      draft: (statement) => {
        if (!/\$b>0\$/.test(statement)) return JSON.stringify(draftFor('a'));
        return '不是 JSON';
      },
    });
    await runBatch(options(dir, out, client));
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as { items: Record<string, { status: string; writtenBy?: string; checkedBy?: string }> };
    expect(manifest.items['bookone-c02-s01-e1']).toMatchObject({ status: 'done', writtenBy: 'deepseek-flash', checkedBy: 'deepseek-flash' });
    expect(manifest.items['bookone-c02-s01-e2']).toMatchObject({ status: 'failed', writtenBy: 'deepseek-flash', checkedBy: 'deepseek-flash' });
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { byDrafter: Record<string, { drafted: number; passedGates: number; gatePassRate: number }> };
    expect(report.byDrafter['deepseek-flash']).toMatchObject({ drafted: 2, passedGates: 1, gatePassRate: 0.5 });
  });

  it('切换之前 Pro 写的题照常进 bundle，不重写；报告和 manifest 都算在 Pro 名下', async () => {
    const { dir, out } = setup(['a']);
    await runBatch(options(dir, out, stubClient()));
    const partId = 'bookone-c02-s01-e1';
    const file = join(out, 'drafts', `${partId}.json`);
    const outcome = JSON.parse(readFileSync(file, 'utf8')) as DraftOutcome;
    delete outcome.draftModel;
    (outcome.pkg?.provenance as { draftedBy: string[] }).draftedBy = ['deepseek-v4-pro'];
    writeFileSync(file, JSON.stringify(outcome));

    const again = stubClient();
    await runBatch(options(dir, out, again, { resume: true }));
    expect(again.countOf('draft')).toBe(0);
    expect(problems(readBundle(out))).toHaveLength(1);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) as { byDrafter: Record<string, { passedGates: number }> };
    expect(report.byDrafter['deepseek-v4-pro']?.passedGates).toBe(1);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as { items: Record<string, { writtenBy?: string }> };
    expect(manifest.items[partId]?.writtenBy).toBe('deepseek-v4-pro');
  });

  it('账户被拒：整轮停下，照实说明原因，已有结果不丢', async () => {
    const { dir, out } = setup(['a', 'b']);
    const blocked = stubClient();
    const chat = blocked.chat.bind(blocked);
    blocked.chat = (async (request) => {
      if (request.stage === 'verify') throw new AccountBlockedError('dashscope', 'Arrearage', 0);
      return chat(request);
    }) as StubClient['chat'];
    const lines: string[] = [];
    const result = await runBatch(options(dir, out, blocked, { log: (line: string) => lines.push(line) }));
    expect(result.budgetStopped).toBe(true);
    expect(lines.join('\n')).toContain('dashscope 账户不可用（Arrearage）');
    expect(lines.join('\n')).not.toContain('已达预算上限');
    expect(blocked.countOf('draft')).toBe(0);
    const resumed = await runBatch(options(dir, out, stubClient(), { resume: true }));
    expect(resumed.budgetStopped).toBe(false);
    expect(problems(readBundle(out))).toHaveLength(2);
  });

  it('断点续传：第二次运行不再调用任何模型，结果相同', async () => {
    const { dir, out } = setup(['a', 'b']);
    const first = stubClient();
    await runBatch(options(dir, out, first));
    expect(first.countOf('verify')).toBe(2);
    expect(first.countOf('draft')).toBe(2);
    const before = problems(readBundle(out)).map((line) => line.contentHash);

    await expect(runBatch(options(dir, out, stubClient()))).rejects.toThrow('--resume');

    const second = stubClient();
    await runBatch(options(dir, out, second, { resume: true }));
    expect(second.calls.filter((call) => call.stage !== 'segment')).toHaveLength(0);
    expect(problems(readBundle(out)).map((line) => line.contentHash)).toEqual(before);
  });

  it('图片走 OCR，且按页缓存', async () => {
    const root = tempDir();
    const dir = join(root, 'sources');
    mkdirSync(dir);
    writeFileSync(join(dir, 'scan.png'), Buffer.from([0x89, 0x50]));
    const out = join(root, 'out');
    const first = stubClient();
    await runBatch(options(dir, out, first));
    expect(first.countOf('ocr')).toBe(1);
    expect(problems(readBundle(out))).toHaveLength(1);
    const second = stubClient();
    await runBatch(options(dir, out, second, { resume: true }));
    expect(second.countOf('ocr')).toBe(0);
  });

  it('失败隔离：起草不过门禁的题进 failed.json，其它题照常发布', async () => {
    const { dir, out } = setup(['a', 'b', 'c']);
    const client = stubClient({
      draft: (statement) => {
        const draft = draftFor(/\$b>0\$/.test(statement) ? 'b' : /\$c>0\$/.test(statement) ? 'c' : 'a');
        if (/\$b>0\$/.test(statement)) {
          // 一道永远走不通（模式不可能命中）的题
          // 样例也写成证明里没有的式子，否则组装时会按样例补字面模式。
          (draft.keys as Array<{ patterns: string[]; examples: string[] }>)[1] = {
            ...(draft.keys as Array<Record<string, unknown>>)[1],
            patterns: ['不可能命中甲', '不可能命中乙'],
            examples: ['令 $q=1$ 即可', '令 $q=2$ 即可'],
          } as never;
        }
        if (/\$c>0\$/.test(statement)) {
          (draft.keys as Array<{ hints: string[] }>)[0]!.hints[0] = '坏公式 $\\frac{1$';
        }
        return JSON.stringify(draft);
      },
    });
    await runBatch(options(dir, out, client));
    const ready = problems(readBundle(out)).map((line) => line.pkg.id);
    expect(ready).toEqual(['imp-bookone-c02-s01-e1']);
    const failed = readFailed(out);
    expect(failed.filter((entry) => entry.stage === 'draft').map((entry) => entry.id).sort()).toEqual([
      'bookone-c02-s01-e2',
      'bookone-c02-s01-e3',
    ]);
    // 每题最多三次（首稿 + 两次回喂）
    expect(client.countOf('draft-repair')).toBe(4);
  });

  it('校验模型拒绝的题不会起草；缺口可修补的要复核通过才算', async () => {
    const root = tempDir();
    const dir = join(root, 'sources');
    mkdirSync(dir);
    const lines = [
      '[页眉] 第二章 数列极限',
      '§1 数列极限概念',
      `1. ${stemFor('a')}`,
      `证 ${solutionFor('a')}`,
      `2. ${stemFor('b')}（缺条件）`,
      `证 ${solutionFor('b')}`,
      `3. ${stemFor('c')}`,
      `证 有洞 ${solutionFor('c')}`,
      `4. ${stemFor('d')}`,
      `证 修不好 ${solutionFor('d')}`,
    ];
    writeFileSync(join(dir, 'bookone.md'), lines.join('\n'));
    const out = join(root, 'out');
    const client = stubClient();
    await runBatch(options(dir, out, client));
    const ready = problems(readBundle(out)).map((line) => line.pkg.id).sort();
    expect(ready).toEqual(['imp-bookone-c02-s01-e1', 'imp-bookone-c02-s01-e3']);
    const failed = readFailed(out);
    expect(failed.find((entry) => entry.id === 'bookone-c02-s01-e2')?.reason).toBe('statement_incomplete');
    expect(failed.find((entry) => entry.id === 'bookone-c02-s01-e4')?.reason).toContain('repair_rejected');
    const repaired = JSON.parse(readFileSync(join(out, 'verify', 'bookone-c02-s01-e3.json'), 'utf8')) as VerifiedPart;
    expect(repaired.repaired).toBe(true);
    expect(repaired.solution).not.toContain('有洞');
  });

  it('预算上限：达到后不再发起调用，并如实报告', async () => {
    const { dir, out } = setup(['a', 'b']);
    const ledgerFile = join(out, 'costs.jsonl');
    mkdirSync(out, { recursive: true });
    new CostLedger({ file: ledgerFile, budget: 10 }).record({ stage: 'x', model: 'qwen3.8-flash', input: 0, output: 0, cached: 0, cost: 5 });
    let fetches = 0;
    const ledger = new CostLedger({ file: ledgerFile, budget: 1 });
    const client = createChatClient({
      ledger,
      env: { DASHSCOPE_API_KEY: 'test', DEEPSEEK_API_KEY: 'test' },
      fetchImpl: (async () => {
        fetches += 1;
        return new Response('{}');
      }) as typeof fetch,
    });
    const result = await runBatch(options(dir, out, client as StubClient, { resume: true, budgetCny: 1 }));
    expect(result.budgetStopped).toBe(true);
    expect(fetches).toBe(0);
  });
});

describe('起草回喂', () => {
  const item: SegmentedItem = {
    id: 'book-c02-s01-e1',
    book: 'book',
    chapterNo: 2,
    chapter: '第二章 数列极限',
    volume: '上',
    sectionNo: 1,
    section: '数列极限概念',
    itemType: 'exercise',
    itemNo: '1',
    statement: '',
    analysis: '',
    solution: '',
    pages: [3, 4],
  };
  const part: VerifiedPart = {
    partId: item.id,
    itemId: item.id,
    statement: stemFor('a'),
    solution: solutionFor('a'),
    accepted: true,
    repaired: false,
    verdict: { statementComplete: true, selfContained: true, solutionProvesStatement: true, gaps: [], difficulty: 2, confidence: 0.9 },
  };

  it('校验错误连同逐行 canon 回喂模型，第二次改对就通过', async () => {
    const client = stubClient({
      draft: (_statement, attempt) => {
        const draft = draftFor('a');
        if (attempt === 1) {
          const key = (draft.keys as Array<{ patterns: string[]; examples: string[] }>)[1]!;
          key.patterns = ['取N不会命中', '也不会命中'];
          key.examples = ['令 $q=1$ 即可', '令 $q=2$ 即可'];
        }
        return JSON.stringify(draft);
      },
    });
    const outcome = await draftPart(part, item, { outDir: tempDir(), client, concepts: CONCEPTS as never, batchId: 'test', verifierModel: 'deepseek-flash' });
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(2);
    // 消息数组是同一个，后面又追加了第二稿：回喂是倒数第二条。
    const feedback = client.calls[1]?.messages.at(-2)?.content as string;
    expect(feedback).toContain('canon=');
    expect(feedback).toContain('K2');
  });

  it('提示词换版本后，旧缓存（含失败）不再算数', async () => {
    const outDir = tempDir();
    mkdirSync(join(outDir, 'drafts'), { recursive: true });
    writeFileSync(join(outDir, 'drafts', `${part.partId}.json`), JSON.stringify({ promptVersion: 'imp-0', partId: part.partId, problemId: 'x', ok: false, attempts: 3, cost: 0, issues: [] }));
    const client = stubClient();
    const outcome = await draftPart(part, item, { outDir, client, concepts: CONCEPTS as never, batchId: 'test', verifierModel: 'deepseek-flash' });
    expect(outcome.ok).toBe(true);
    expect(client.calls).toHaveLength(1);
  });

  it('输出不是 JSON 时也会重试，三次都不行就记失败', async () => {
    const client = stubClient({ draft: () => '不是 JSON' });
    const outDir = tempDir();
    const outcome = await draftPart(part, item, { outDir, client, concepts: CONCEPTS as never, batchId: 'test', verifierModel: 'deepseek-flash' });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('bad_json');
    expect(client.calls).toHaveLength(3);
    const again = stubClient();
    const cached = await draftPart(part, item, { outDir, client: again, concepts: CONCEPTS as never, batchId: 'test', verifierModel: 'deepseek-flash' });
    expect(cached.ok).toBe(false);
    expect(again.calls).toHaveLength(0);
  });

  it('组装：片段是题面子串的删掉，能截走样例的错误模式丢弃，题面用校验过的原文', () => {
    const draft = draftFor('a');
    (draft.keys as Array<{ leak: string[] }>)[0]!.leak.push('a/n=0');
    (draft.errors as unknown[]).push({ label: '太宽', patterns: ['N='], question: '这样取对吗？' });
    const pkg = assemblePackage(draft, {
      part,
      item,
      problemId: problemIdFor(part.partId),
      concepts: CONCEPTS as never,
      batchId: 'test',
      model: 'qwen3.8-flash',
      verifierModel: 'deepseek-flash',
    });
    expect(pkg.public.stem).toBe(stemFor('a'));
    expect(pkg.secret.keys[0]?.leak).not.toContain('a/n=0');
    expect(pkg.secret.errors.map((error) => error.label)).toEqual(['N 依赖 n']);
    expect(pkg.secret.routes).toEqual([['K1', 'K2', 'K3']]);
    expect(pkg.public.source?.pages).toEqual([3, 4]);
    expect(runImportGates(pkg, CONCEPTS as never).issues).toEqual([]);
  });

  it('改写出另一份证明会被拦下：参考证明必须来自已核验的证明', async () => {
    const other = draftFor('a');
    other.referenceProof = [
      '令 $\\left|\\frac{a}{n}-0\\right|=\\frac{a}{n}$ 且 $\\frac{a}{n}=\\frac{2a}{2n}=\\frac{3a}{3n}$。',
      '取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+100$ 而 $\\sqrt{n+100}>\\sqrt{100}$。',
      '当 $n>N$ 时，$\\frac{a}{n+100}<\\frac{a}{n}<\\varepsilon$ 且 $\\frac{a}{n+200}<\\varepsilon$。',
    ];
    const client = stubClient({ draft: () => JSON.stringify(other) });
    const outcome = await draftPart(part, item, { outDir: tempDir(), client, concepts: CONCEPTS as never, batchId: 'test', verifierModel: 'deepseek-flash' });
    expect(outcome.ok).toBe(false);
    expect(outcome.issues[0]?.message).toContain('已核验');
  });

  it('修模式：u 模式的非法转义、多余空格、(?i)、LaTeX 命令', () => {
    expect(fixPattern('a \\_ b')).toBe('a_b');
    expect(fixPattern('n>N')).toBe('n>N');
    expect(() => new RegExp(fixPattern('x\\,y'), 'u')).not.toThrow();
    expect(fixPattern('(?i)abc')).toBe('abc');
    expect(fixPattern('假设.{0,8}a\\+x.{0,8}\\in\\s*Q')).toBe('假设.{0,8}a\\+x.{0,8}∈Q');
    expect(fixPattern('\\varepsilon\\le\\delta')).toBe('ε≤δ');
    expect(fixPattern('\\lim_\\(n\\to\\infty\\)')).toBe('lim_\\(n→∞\\)');
  });

  it('组装：H0 标记去掉、坏模式丢弃、样例没命中时补字面模式、片段转 canon、词条里有的片段删掉', () => {
    const draft = draftFor('a');
    const key = (draft.keys as Array<{ hints: string[]; patterns: string[]; examples: string[]; leak: string[] }>)[0]!;
    key.hints[0] = 'H0: 你要让哪个量小于 $\\varepsilon$？';
    key.patterns.push('(未闭合', '\\frac{a}{n}');
    key.examples.push('于是 $\\frac{a}{n+1}<\\frac{a}{n}$');
    key.leak.push('\\frac{a}{n+1}', '1/n^p');
    const pkg = assemblePackage(draft, {
      part,
      item,
      problemId: 'imp-x',
      concepts: { concepts: [], glossary: [{ id: 'g', answer: '形如 $\\sum\\frac{1}{n^p}$ 的级数。' }] } as never,
      batchId: 'test',
      model: 'm',
      verifierModel: 'v',
    });
    const built = pkg.secret.keys[0]!;
    expect(built.hints[0]?.text).toBe('你要让哪个量小于 $\\varepsilon$？');
    expect(built.patterns).toEqual(['\\|a/n(-0)?\\|', 'a/n<ε', 'a/\\(n\\+1\\)<a/n']);
    expect(built.examples).toHaveLength(3);
    expect(built.leak).toEqual(['a/n<ε', 'a/(n+1)']);
  });

  function assembled(draft: Record<string, unknown>) {
    return assemblePackage(draft, {
      part,
      item,
      problemId: 'imp-x',
      concepts: CONCEPTS as never,
      batchId: 'test',
      model: 'm',
      verifierModel: 'v',
    });
  }

  it('组装：模型指明步骤所在的行，模式没命中那行时补字面模式，抓具体的式子而不是整句', () => {
    const draft = draftFor('a');
    const key = (draft.keys as Array<Record<string, unknown>>)[1]!;
    key.patterns = ['不可能命中'];
    key.proofLine = 2;
    const built = assembled(draft).secret.keys[1]!;
    expect(built.patterns).toContain('N=\\[a/ε\\]\\+1');
    expect(/N=\[a\/ε\]\+1/u.test(canon('于是令 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$ 就行'))).toBe(true);
  });

  it('回喂是补丁：只改一个步骤，其它内容沿用上一稿', async () => {
    const client = stubClient({
      draft: (_statement, attempt) => {
        if (attempt === 2) return JSON.stringify({ keys: [{ id: 'K2', patterns: ['N[=≥].{0,12}a/ε', 'n>a/ε'], examples: ['取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$', '只要 $n>\\frac{a}{\\varepsilon}$'] }] });
        const draft = draftFor('a');
        const key = (draft.keys as Array<{ patterns: string[]; examples: string[] }>)[1]!;
        key.patterns = ['取N不会命中', '也不会命中'];
        key.examples = ['令 $q=1$ 即可', '令 $q=2$ 即可'];
        return JSON.stringify(draft);
      },
    });
    const outcome = await draftPart(part, item, { outDir: tempDir(), client, concepts: CONCEPTS as never, batchId: 'test', verifierModel: 'deepseek-flash' });
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(2);
    expect(outcome.pkg?.secret.keys.map((key) => key.label)).toEqual(['化简绝对值', '取 N', '收尾']);
    expect(outcome.pkg?.public.title).toBe('用定义证明 a/n 趋于 0');
  });

  it('组装：核心步骤命中题面的模式去掉；全都命中时这一步按 formal 算', () => {
    const draft = draftFor('a');
    const keys = draft.keys as Array<{ patterns: string[]; kind: string }>;
    keys[0]!.patterns.push('lim_\\(n→∞\\)a/n=0');
    keys[1]!.patterns = ['lim_\\(n→∞\\)', 'a/n=0'];
    const built = assembled(draft).secret.keys;
    expect(built[0]!.patterns).not.toContain('lim_\\(n→∞\\)a/n=0');
    expect(built[0]!.kind).toBe('core');
    expect(built[1]!.kind).toBe('formal');
  });

  it('组装：模式和样例不够两条时用证明行补', () => {
    const draft = draftFor('a');
    const key = (draft.keys as Array<Record<string, unknown>>)[1]!;
    key.patterns = ['N=\\[a/ε\\]\\+1'];
    key.examples = [];
    key.proofLine = 2;
    const built = assembled(draft).secret.keys[1]!;
    expect(built.patterns.length).toBeGreaterThanOrEqual(2);
    expect(built.examples).toEqual(['取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。']);
  });

  it('组装：样例不够两条时，先用命中这一步的证明行，再用 H4 的第一句', () => {
    const draft = draftFor('a');
    const key = (draft.keys as Array<Record<string, unknown>>)[1]!;
    key.examples = [];
    key.hints = ['问', '框架', '方向', '一半', '取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+2$。下一行由你写。'];
    key.patterns = ['N=\\[a/ε\\]\\+[12]', 'n>a/ε'];
    const built = assembled(draft).secret.keys[1]!;
    expect(built.examples).toEqual(['取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。', '取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+2$。']);
  });

  it('组装：H2 全部能照抄、步骤名也带片段时，退回不带式子的通用方向', () => {
    const draft = draftFor('a');
    const key = (draft.keys as Array<{ hints: string[]; label: string; leak: string[] }>)[1]!;
    key.label = '取 N=[a/ε]+1';
    key.leak = ['N=[a/ε]+1'];
    key.hints[2] = '可以试试 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。';
    expect(assembled(draft).secret.keys[1]!.hints[2]?.text).toBe('回到上一步得到的结论，想一想接下来该用哪个定义或定理。');
  });

  it('组装：H2 里能照抄的句子去掉，全去掉时只点明这一步要做什么', () => {
    const draft = draftFor('a');
    const keys = draft.keys as Array<{ hints: string[]; label: string }>;
    keys[1]!.hints[2] = '从目标解出下界。可以试试 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。';
    keys[2]!.hints[2] = '当 $n>N$ 时，$\\left|\\frac{a}{n}-0\\right|<\\varepsilon$。';
    const built = assembled(draft).secret.keys;
    expect(built[1]!.hints[2]?.text).toBe('从目标解出下界。');
    expect(built[2]!.hints[2]?.text).toBe('这一步要做的是“收尾”。想一想该用哪个定义或定理。');
  });

  it('组装：还有别的真片段时，H0/H1 已写出的片段不算秘密；错误追问带片段的丢掉', () => {
    const draft = draftFor('a');
    const keys = draft.keys as Array<{ hints: string[]; leak: string[] }>;
    keys[1]!.leak = ['a/ε', 'N=[a/ε]+1'];
    keys[1]!.hints[1] = '解出 $n>\\frac{a}{\\varepsilon}$ 就有方向了。';
    (draft.errors as Array<Record<string, unknown>>).push({ label: '带片段', patterns: ['不可能出现'], question: '$N=[a/\\varepsilon]+1$ 对吗？' });
    const pkg = assembled(draft);
    expect(pkg.secret.keys[1]!.leak).toEqual(['N=[a/ε]+1']);
    expect(pkg.secret.errors.map((error) => error.label)).toEqual(['N 依赖 n']);
  });

  it('片段：canon 形式的不再过 canon（不是幂等的），还带 LaTeX 的才转', () => {
    expect(fragmentCanon('x_(n+1)≥x_n')).toBe('x_(n+1)≥x_n');
    expect(fragmentCanon('lim_(k→∞) a_n_k = A')).toBe('lim_(k→∞)a_n_k=A');
    expect(fragmentCanon('x_{n+1}\\geqslant x_n')).toBe('x_(n+1)≥x_n');
    expect(fragmentCanon('$\\frac{a}{n+1}$')).toBe('a/(n+1)');
    expect(fragmentCanon('x^{2n}')).toBe('x^(2n)');
    expect(canon('于是 $x_{n+1}\\geqslant x_n$').includes(fragmentCanon('x_(n+1)≥x_n'))).toBe(true);
  });

  it('组装：H4 没有把下一行交还学生时补上', () => {
    const draft = draftFor('a');
    const keys = draft.keys as Array<{ hints: string[] }>;
    keys[1]!.hints[4] = '取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。';
    const built = assembled(draft).secret.keys;
    expect(built[1]!.hints[4]?.text).toBe('取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。下一行由你写。');
    expect(built[0]!.hints[4]?.text).toMatch(/下一行由你写：\$n\$ 要满足什么？$/);
  });

  it('组装：样例只有空话时，核心步骤不补模式，样例丢掉', () => {
    const draft = draftFor('a');
    const key = (draft.keys as Array<Record<string, unknown>>)[1]!;
    key.examples = ['故原不等式成立。', '取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$'];
    const built = assembled(draft).secret.keys[1]!;
    expect(built.patterns).toHaveLength(2);
    // 空话样例丢掉后不够两条，由命中这一步的证明行补。
    expect(built.examples).toEqual(['取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$', '取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。']);
  });

  it('组装：绝对值竖线忘了转义时修好，修不好的宽模式丢掉', () => {
    expect(fixPattern('||f\\(x\\)\\|-\\|A\\|\\|≤\\|f\\(x\\)-A\\|')).toBe('\\|\\|f\\(x\\)\\|-\\|A\\|\\|≤\\|f\\(x\\)-A\\|');
    const draft = draftFor('a');
    (draft.keys as Array<{ patterns: string[] }>)[0]!.patterns.push('.*');
    expect(assembled(draft).secret.keys[0]!.patterns).not.toContain('.*');
  });

  it('组装：片段都没在样例和证明里出现时，核心步骤改用样例里最具体的式子，formal 步骤清空', () => {
    const draft = draftFor('a');
    const keys = draft.keys as Array<{ leak: string[] }>;
    keys[1]!.leak = ['q/w=z'];
    keys[2]!.leak = ['q/w=z'];
    const built = assembled(draft).secret.keys;
    expect(built[1]!.leak).toEqual(['N=[a/ε]+1']);
    expect(built[2]!.leak).toEqual([]);
  });

  it('失败归类', () => {
    expect(categorize([{ where: 'replay.K1', message: 'x' }])).toBe('replay');
    expect(categorize([{ where: 'K1.leak', message: '片段太短' }])).toBe('leak');
    expect(categorize([{ where: 'package', message: 'JSON Schema：不合法' }])).toBe('schema');
  });
});

describe('校验', () => {
  const part = { partId: 'p', no: '1', statement: stemFor('a'), solution: solutionFor('a') };

  it('低把握视同拒绝，并按文件缓存', async () => {
    const outDir = tempDir();
    const client = stubClient();
    client.chat = (async (request) => ({
      text: JSON.stringify({ statementComplete: true, selfContained: true, solutionProvesStatement: true, gaps: [], difficulty: 3, confidence: 0.5 }),
      finishReason: 'stop',
      usage: { input: 1, output: 1, cached: 0 },
      cost: 0,
      model: request.model,
    })) as StubClient['chat'];
    const result = await verifyPart(part, 'p', client, outDir);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('low_confidence');
    const cached = await verifyPart(part, 'p', stubClient(), outDir);
    expect(cached.reason).toBe('low_confidence');
  });

  it('这一轮文本阶段全部用 deepseek-flash，核验开思考', async () => {
    expect([DRAFT_MODEL, REPAIR_MODEL, VERIFY_MODEL, NORMALIZE_MODEL, SEGMENT_MODEL, VARIATION_MODEL]).toEqual(Array(6).fill('deepseek-flash'));
    const client = stubClient();
    const result = await verifyPart(part, 'p', client, tempDir());
    expect(client.calls[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-flash', thinking: true });
    expect(result.verifierModel).toBe('deepseek-flash');
  });

  it('难度映射到三档', () => {
    expect([1, 2, 3, 4, 5].map(bandOf)).toEqual(['easy', 'easy', 'medium', 'hard', 'hard']);
  });
});

describe('选题', () => {
  const makePart = (id: string, difficulty: number, confidence = 0.9): VerifiedPart => ({
    partId: id,
    itemId: id,
    statement: id,
    solution: 'x'.repeat(200),
    accepted: true,
    repaired: false,
    verdict: { statementComplete: true, selfContained: true, solutionProvesStatement: true, gaps: [], difficulty, confidence },
  });
  const itemOf = (partId: string): SegmentedItem => ({ chapterNo: Number(partId.split('-')[0]) } as SegmentedItem);

  it('每章都覆盖，三档比例接近目标', () => {
    const parts: VerifiedPart[] = [];
    for (let chapter = 1; chapter <= 10; chapter += 1) {
      for (let index = 0; index < 60; index += 1) parts.push(makePart(`${chapter}-${index}`, (index % 5) + 1));
    }
    const picked = selectForDraft(parts, itemOf, 100);
    expect(picked).toHaveLength(100);
    const chapters = new Set(picked.map((part) => itemOf(part.partId).chapterNo));
    expect(chapters.size).toBe(10);
    const bands = { easy: 0, medium: 0, hard: 0 };
    for (const part of picked) bands[bandOf(part.verdict.difficulty)] += 1;
    expect(bands.easy).toBeGreaterThanOrEqual(25);
    expect(bands.medium).toBeGreaterThanOrEqual(30);
    expect(bands.hard).toBeGreaterThanOrEqual(15);
  });

  it('小章节也至少入选几题；候选不足时全取', () => {
    const parts = [makePart('1-0', 2), makePart('1-1', 3), ...Array.from({ length: 50 }, (_, index) => makePart(`2-${index}`, 3))];
    const picked = selectForDraft(parts, itemOf, 20);
    expect(picked.filter((part) => part.partId.startsWith('1-'))).toHaveLength(2);
    expect(selectForDraft(parts.slice(0, 2), itemOf, 20)).toHaveLength(2);
  });

  it('按章轮转抽样', () => {
    const sample = spreadByChapter([1, 1, 1, 2, 3], (value) => value, 3);
    expect(sample).toEqual([1, 2, 3]);
  });

  it('变式抽样比例与确定性', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `id-${index}`);
    expect(sampleForVariation(ids, 0.1)).toHaveLength(4);
    expect(sampleForVariation(ids, 0.1)).toEqual(sampleForVariation(ids, 0.1));
  });
});

describe('账本与模型客户端', () => {
  it('按实际用量计费，重启后累计额不丢', () => {
    const file = join(tempDir(), 'costs.jsonl');
    const ledger = new CostLedger({ file, budget: 10 });
    const entry = ledger.record({ stage: 'ocr', model: 'qwen3-vl-plus', input: 1_000_000, output: 1_000_000, cached: 0 });
    expect(entry.cost).toBeCloseTo(11);
    const reopened = new CostLedger({ file, budget: 10 });
    expect(reopened.spent()).toBeCloseTo(11);
    expect(() => reopened.assertWithinBudget()).toThrow(BudgetExceededError);
  });

  it('DeepSeek 分时计价；未收录的模型按贵的算', () => {
    const peak = new Date('2026-11-06T02:00:00Z'); // 北京周五 10 点
    const offPeak = new Date('2026-11-07T02:00:00Z'); // 北京周六
    expect(isDeepSeekPeak(peak)).toBe(true);
    expect(isDeepSeekPeak(offPeak)).toBe(false);
    const usage = { input: 1_000_000, output: 0, cached: 0 };
    expect(costOf('deepseek-flash', usage, peak)).toBeCloseTo(2);
    expect(costOf('deepseek-flash', usage, offPeak)).toBeCloseTo(1);
    expect(costOf('未知模型', usage)).toBeCloseTo(12);
  });

  it('429 与网络错误会重试，审查拒绝不重试；错误信息不含密钥', async () => {
    const ledger = new CostLedger({ budget: 10 });
    const responses: Array<() => Response> = [
      () => new Response('slow down', { status: 429 }),
      () => {
        throw new TypeError('fetch failed');
      },
      () => new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })),
    ];
    let calls = 0;
    const client = createChatClient({
      ledger,
      env: { DASHSCOPE_API_KEY: 'SECRET-KEY' },
      sleep: async () => undefined,
      fetchImpl: (async () => responses[calls++]!()) as typeof fetch,
    });
    const request = { stage: 'x', provider: 'dashscope' as const, model: 'qwen3.8-flash', messages: [] };
    const response = await client.chat(request);
    expect(response.text).toBe('好');
    expect(calls).toBe(3);
    expect(ledger.spent()).toBeGreaterThan(0);

    const refuse = createChatClient({
      ledger,
      env: { DASHSCOPE_API_KEY: 'SECRET-KEY' },
      sleep: async () => undefined,
      fetchImpl: (async () => new Response(JSON.stringify({ error: { code: 'data_inspection_failed' } }), { status: 400 })) as typeof fetch,
    });
    await expect(refuse.chat(request)).rejects.toMatchObject({ code: 'data_inspection_failed' });
    await expect(refuse.chat(request)).rejects.not.toThrow('SECRET-KEY');

    const noKey = createChatClient({ ledger, env: {} });
    await expect(noKey.chat(request)).rejects.toThrow('DASHSCOPE_API_KEY');
  });

  it('账户欠费、余额不足：按预算停止处理，整轮停下，错误里不带密钥', async () => {
    const ledger = new CostLedger({ file: join(tempDir(), 'costs.jsonl'), budget: 100 });
    const blockedBy = (status: number, body: string) =>
      createChatClient({
        ledger,
        env: { DASHSCOPE_API_KEY: 'SECRET-KEY', DEEPSEEK_API_KEY: 'SECRET-KEY' },
        sleep: async () => undefined,
        fetchImpl: (async () => new Response(body, { status })) as typeof fetch,
      });
    const dashscope = { stage: 'x', provider: 'dashscope' as const, model: 'qwen3.8-flash', messages: [] };
    const deepseek = { stage: 'x', provider: 'deepseek' as const, model: 'deepseek-flash', messages: [] };
    await expect(blockedBy(400, JSON.stringify({ error: { code: 'Arrearage' } })).chat(dashscope)).rejects.toBeInstanceOf(AccountBlockedError);
    await expect(blockedBy(403, JSON.stringify({ error: { code: 'AccessDenied.Unpurchased' } })).chat(dashscope)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(blockedBy(402, '余额不足').chat(deepseek)).rejects.toThrow(/deepseek 账户不可用（insufficient_balance）/);
    await expect(blockedBy(400, JSON.stringify({ error: { code: 'Arrearage' } })).chat(dashscope)).rejects.not.toThrow('SECRET-KEY');
  });

  it('按模型选供应商：百炼上的 deepseek 权重走百炼', () => {
    expect(providerOf('deepseek-flash')).toBe('deepseek');
    expect(providerOf('deepseek-v4-pro')).toBe('deepseek');
    expect(providerOf('deepseek-v4.1-flash')).toBe('dashscope');
    expect(providerOf('qwen3.8-flash')).toBe('dashscope');
  });

  it('宽松解析 JSON：代码块与前后说明', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('结果如下：{"a":2}。')).toEqual({ a: 2 });
    expect(() => parseJsonLoose('没有')).toThrow();
  });

  it('单反斜杠的 LaTeX：报错的和悄悄损坏的都修回来，正确转义的不动', () => {
    expect(parseJsonLoose('{"s":"$\\lim x$"}')).toEqual({ s: '$\\lim x$' });
    expect(parseJsonLoose('{"s":"$\\sqrt{2}$ 和 $\\underline{a}$"}')).toEqual({ s: '$\\sqrt{2}$ 和 $\\underline{a}$' });
    expect(parseJsonLoose('{"s":"$\\frac{1}{2}$"}')).toEqual({ s: '$\\frac{1}{2}$' });
    expect(parseJsonLoose('{"s":"$\\beta$ $\\neq$ $\\rho$ $\\tau$"}')).toEqual({ s: '$\\beta$ $\\neq$ $\\rho$ $\\tau$' });
    expect(parseJsonLoose('{"s":"$\\\\frac{1}{2}$"}')).toEqual({ s: '$\\frac{1}{2}$' });
    expect(parseJsonLoose('{"s":"第一行\\n第二行"}')).toEqual({ s: '第一行\n第二行' });
    expect(parseJsonLoose('{"s":"\\u4e2d"}')).toEqual({ s: '中' });
    // 同时有非法和“合法”单反斜杠：整段走修复
    expect(parseJsonLoose('{"s":"$\\frac{1}{\\sqrt{2}}$"}')).toEqual({ s: '$\\frac{1}{\\sqrt{2}}$' });
  });
});

describe('打包', () => {
  const itemOf = (partId: string): SegmentedItem =>
    ({
      chapterNo: 2,
      chapter: '第二章 数列极限',
      sectionNo: Number(partId.split('-')[1]),
      section: `第 ${partId.split('-')[1]} 节`,
    }) as SegmentedItem;

  function outcome(id: string, difficulty: number, quality: number): DraftOutcome {
    const part: VerifiedPart = {
      partId: id,
      itemId: id,
      statement: stemFor('a'),
      solution: solutionFor('a'),
      accepted: true,
      repaired: false,
      verdict: { statementComplete: true, selfContained: true, solutionProvesStatement: true, gaps: [], difficulty, confidence: 0.9 },
    };
    const pkg = assemblePackage(draftFor('a'), {
      part,
      item: itemOf(id),
      problemId: `imp-${id}`,
      concepts: CONCEPTS as never,
      batchId: 'b',
      model: 'm',
      verifierModel: 'v',
    });
    return { promptVersion: 'imp-test', partId: id, problemId: pkg.id, ok: true, attempts: 1, cost: 0, issues: [], pkg, quality };
  }

  it('往返不变；路径每节最多 5 题，由易到难，质量低的靠后；全部题都在 bundle 里', () => {
    const outcomes = [
      outcome('x-1-a', 4, 0.9),
      outcome('x-1-b', 1, 0.5),
      outcome('x-1-c', 1, 0.9),
      outcome('x-1-d', 3, 0.9),
      outcome('x-1-e', 5, 0.9),
      outcome('x-1-f', 2, 0.8),
      outcome('x-1-g', 3, 0.7),
      outcome('x-2-a', 2, 0.9),
      { promptVersion: 'imp-test', partId: 'x-2-bad', problemId: 'imp-x-2-bad', ok: false, attempts: 3, cost: 0, issues: [] },
    ];
    const lines = buildBundle({ batchId: 'b', outcomes, itemOf, now: new Date('2026-11-06T00:00:00Z') });
    expect(decodeBundle(encodeBundle(lines))).toEqual(lines);
    expect(lines[0]).toMatchObject({ type: 'header', problems: 8, units: 2 });
    const unit = lines.find((line) => line.type === 'unit' && line.unitNo === 101);
    expect(unit).toBeDefined();
    if (unit?.type !== 'unit') throw new Error('unit');
    expect(unit.items).toHaveLength(5);
    const ranks = unit.items.map((id) => problems(lines).find((line) => line.pkg.id === id)?.pkg.public.difficulty as number);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(unit.items[0]).toBe('imp-x-1-c');
    expect(unit.summary).toContain('7 道');
    expect(problems(lines).filter((line) => line.pathEligible)).toHaveLength(6);
  });

  it('内容哈希：内容变了才变，来源信息不算', () => {
    const pkg = outcome('x-1-a', 2, 0.9).pkg as ProblemPackage;
    const same = { ...pkg, provenance: { importJobId: 'other' } } as ProblemPackage;
    expect(contentHash(same)).toBe(contentHash(pkg));
    const changed = structuredClone(pkg);
    changed.public.title = '别的标题';
    expect(contentHash(changed)).not.toBe(contentHash(pkg));
  });
});

describe('学生在引擎里做完一道导入题', () => {
  it('开题落在第 3 层，写完参考证明进第 6 层，总结后完成，自检与迁移都跳过', () => {
    const client = stubClient();
    void client;
    const part: VerifiedPart = {
      partId: 'p',
      itemId: 'p',
      statement: stemFor('a'),
      solution: solutionFor('a'),
      accepted: true,
      repaired: false,
      verdict: { statementComplete: true, selfContained: true, solutionProvesStatement: true, gaps: [], difficulty: 2, confidence: 0.9 },
    };
    const pkg = assemblePackage(draftFor('a'), {
      part,
      item: { chapterNo: 2, chapter: '第二章', volume: '上', section: '', itemType: 'exercise', itemNo: '1', book: 'b', pages: [1] } as SegmentedItem,
      problemId: 'imp-p',
      concepts: CONCEPTS as never,
      batchId: 'b',
      model: 'm',
      verifierModel: 'v',
    });
    const ctx = { pkg, concepts: { concepts: [], glossary: [] } };
    let state = createAttempt(ctx, 0);
    expect(state.layer).toBe(3);
    solutionFor('a').split('\n').forEach((line, index) => {
      state = step(ctx, state, { kind: 'line.submit', lineId: `L${index}`, s: line, j: '', provenance: 'keyboard' }, 1000 * (index + 1)).state;
    });
    const finish = step(ctx, state, { kind: 'finish.try' }, 10_000);
    state = finish.state;
    expect(finish.events[0]?.payload.complete).toBe(true);
    expect(state.layer).toBe(6);
    const summary = step(ctx, state, { kind: 'summary.submit', answers: ['关键是按定义取 N。'] }, 20_000);
    expect(summary.state.done).toBe(true);
    expect(summary.events.find((event) => event.type === 'attempt.complete')?.payload.keysOwn).toBe(3);
  });
});
