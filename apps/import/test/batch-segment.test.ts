import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { dedupeKey, ruleRejectReason, selectCandidates } from '../src/batch/candidate.ts';
import { normalizeOcrText } from '../src/batch/ocr-stage.ts';
import {
  boundariesByRule,
  chineseNumeral,
  mergeWindows,
  pageLines,
  parseBoundaries,
  parseHeader,
  segmentBook,
  stitchItems,
  windowsOf,
  type PageMeta,
  type SegmentedItem,
  type WindowResult,
} from '../src/batch/segment.ts';
import { sourceIdOf, walkSources } from '../src/batch/walk.ts';
import { splitItems } from '../src/split.ts';
import { stubClient } from './batch-fixtures.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pg-seg-'));
}

describe('目录遍历', () => {
  it('递归找 PDF、图片、Markdown，跳过隐藏目录和 node_modules，加密 PDF 标记跳过', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'sub'));
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, '.git'));
    for (const name of ['a.pdf', 'locked.pdf', 'sub/b.png', 'sub/c.jpeg', 'sub/d.webp', 'e.md', 'f.txt', 'g.docx', 'node_modules/x.md', '.git/y.md']) {
      writeFileSync(join(dir, name), 'x');
    }
    const files = walkSources(dir, {
      probe: (file) => (file.endsWith('locked.pdf') ? { pages: 0, error: '受密码保护，已跳过（不尝试绕过）' } : { pages: 12 }),
    });
    expect(files.map((file) => file.relPath).sort()).toEqual(['a.pdf', 'e.md', 'f.txt', 'locked.pdf', 'sub/b.png', 'sub/c.jpeg', 'sub/d.webp']);
    expect(files.find((file) => file.relPath === 'a.pdf')).toMatchObject({ kind: 'pdf', pages: 12, id: 'a' });
    expect(files.find((file) => file.relPath === 'locked.pdf')?.skipped).toContain('密码');
    expect(files.find((file) => file.relPath === 'e.md')?.kind).toBe('text');
  });

  it('中文文件名用路径哈希当 ID', () => {
    expect(sourceIdOf('数学分析.pdf')).toMatch(/^src-[0-9a-f]{8}$/);
    expect(sourceIdOf('sub/a-hd3.pdf')).toBe('a-hd3');
  });
});

describe('OCR 文本规范化', () => {
  it('跨行 $$ 压成单行 $', () => {
    expect(normalizeOcrText('前\n$$\na+b\n=c\n$$  \n后')).toBe('前\n$a+b =c$\n后');
    expect(normalizeOcrText('\\[x\\]')).toBe('$x$');
  });
});

describe('规则切分', () => {
  const lines = (text: string) => pageLines(5, text);

  it('认 【例 n】、【题 n.m】、例 n、第 n 题、连续编号；小题和证明内部分步不切', () => {
    const page = [
      '§2 连续函数的性质',
      '○1. 证明 $x>0$。',
      '(1) 第一小题；',
      '证 由定义。',
      '1. 先看第一步。',
      '◎2. 证明 $y>0$。',
      '证明 显然。',
      '【例 3】 证明 $z>0$。',
      '分析 想一想。',
      '证明 写一写。',
      '例 4 证明 $w>0$。',
      '解 算一算。',
      '第 5 题 证明 $v>0$。',
      '证 好。',
      '【题 2.1】（北京大学，2003）证明 $u>0$。',
      '解析过程 这样。',
    ].join('\n');
    const boundaries = boundariesByRule(lines(page));
    expect(boundaries.map((b) => [b.kind, b.no])).toEqual([
      ['section', undefined],
      ['exercise', '1'],
      ['exercise', '2'],
      ['example', '3'],
      ['example', '4'],
      ['exercise', '5'],
      ['exam', '2.1'],
    ]);
    expect(boundaries[1]?.solutionLine).toBe('5:4');
    expect(boundaries[3]?.analysisLine).toBe('5:9');
    expect(boundaries[3]?.solutionLine).toBe('5:10');
    expect(boundaries[6]?.examSource).toBe('北京大学，2003');
  });

  it('split.ts 的 P0 规则也认新格式', () => {
    const items = splitItems([{ page: 1, text: '【例 1】证明 a\n证明：好\n第 2 题 求 b\n解：好\n' }]);
    expect(items.map((item) => item.label.slice(0, 5))).toEqual(['【例 1】', '第 2 题']);
  });
});

describe('模型切分结果', () => {
  it('丢弃不存在的行号和未知类型', () => {
    const known = new Set(['1:1', '1:2']);
    const parsed = parseBoundaries(
      '```json\n{"boundaries":[{"line":"1:1","kind":"exercise","no":3,"solutionLine":"1:2"},{"line":"9:9","kind":"exercise"},{"line":"1:2","kind":"banana"}]}\n```',
      known,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ line: '1:1', no: '3', solutionLine: '1:2' });
    expect(() => parseBoundaries('{"x":1}', known)).toThrow();
  });

  it('窗口大小 3 步长 2，末尾不多出空窗口', () => {
    expect(windowsOf([1, 2, 3, 4, 5]).map((window) => window.pages)).toEqual([
      [1, 2, 3],
      [3, 4, 5],
    ]);
    expect(windowsOf([1, 2]).map((window) => window.pages)).toEqual([[1, 2]]);
  });

  it('每页以核心窗口为准，解答行从别的窗口补全', () => {
    const windows: WindowResult[] = [
      {
        start: 1,
        pages: [1, 2, 3],
        source: 'model',
        boundaries: [
          { line: '2:5', kind: 'exercise', no: '7', solutionLine: null },
          { line: '3:1', kind: 'exercise', no: '99', solutionLine: null }, // 第 3 页不是这个窗口的核心页：误判被忽略
        ],
      },
      {
        start: 3,
        pages: [3, 4, 5],
        source: 'model',
        boundaries: [{ line: '3:4', kind: 'exercise', no: '8', solutionLine: '4:1' }],
      },
      { start: 0, pages: [2, 3, 4], source: 'model', boundaries: [{ line: '2:5', kind: 'exercise', no: '7', solutionLine: '3:2' }] },
    ];
    const merged = mergeWindows(windows);
    expect(merged.map((boundary) => boundary.line)).toEqual(['2:5', '3:4']);
    expect(merged[0]?.solutionLine).toBe('3:2');
  });
});

describe('页眉与跨页拼接', () => {
  it('中文数字', () => {
    expect(chineseNumeral('二')).toBe(2);
    expect(chineseNumeral('十')).toBe(10);
    expect(chineseNumeral('十二')).toBe(12);
    expect(chineseNumeral('二十三')).toBe(23);
    expect(chineseNumeral('7')).toBe(7);
    expect(chineseNumeral('章')).toBeNull();
  });

  it('页眉识别章和册', () => {
    expect(parseHeader('[页眉] 第二章 数列极限 · 37 ·\n正文')).toMatchObject({ chapterNo: 2, chapter: '第二 章 数列极限'.replace(' 章', '章') });
    expect(parseHeader('[页眉] • 38 • 数学分析习题详解（上）\n正文')).toMatchObject({ chapterNo: null, volume: '上' });
    expect(parseHeader('[页眉] 数学分析同步辅导及习题全解(下册)\n')).toMatchObject({ volume: '下' });
    expect(parseHeader('没有页眉')).toMatchObject({ chapterNo: null, volume: null });
  });

  it('条目跨页时拼在一起，章节从前面的页延续，页码记全', () => {
    const pages = new Map<number, string>([
      [10, '[页眉] 第三章 函数极限 · 10 ·\n§2 函数极限的性质\n1. 证明 $a>0$。\n证 第一段。'],
      [11, '[页眉] • 11 • 数学分析习题详解（上）\n第二段。\n2. 证明 $b>0$。\n证 另一段。'],
    ]);
    const lines = [...pages.entries()].flatMap(([page, text]) => pageLines(page, text));
    const metas = new Map<number, PageMeta>([...pages.entries()].map(([page, text]) => [page, parseHeader(text)]));
    const items = stitchItems({ book: 'bk', lines, metas, boundaries: boundariesByRule(lines) });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'bk-c03-s02-e1',
      chapterNo: 3,
      chapter: '第三章 函数极限',
      sectionNo: 2,
      section: '函数极限的性质',
      volume: '上',
      statement: '1. 证明 $a>0$。',
      solution: '证 第一段。\n第二段。',
      pages: [10, 11],
    });
    expect(items[1]?.pages).toEqual([11]);
  });

  it('同一编号重复出现（如总练习题再次从 1 编号）时 ID 不撞', () => {
    const lines = pageLines(1, '[页眉] 第一章\n1. 证明 a。\n证 甲。\n知识要点\n1. 证明 b。\n证 乙。');
    const metas = new Map<number, PageMeta>([[1, parseHeader('[页眉] 第一章 实数')]]);
    const items = stitchItems({ book: 'bk', lines, metas, boundaries: boundariesByRule(lines) });
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it('模型失败时退回规则切分，并把结果缓存', async () => {
    const outDir = tempDir();
    const pages = new Map<number, string>([[1, '[页眉] 第一章 实数集\n1. 证明 $a>0$。\n证 这是一段足够长的证明。']]);
    const failing = stubClient({
      segment: () => {
        throw new Error('模型挂了');
      },
    });
    const first = await segmentBook({ outDir, book: 'bk', client: failing, concurrency: 1, pages });
    expect(first.ruleWindows).toBe(1);
    expect(first.items).toHaveLength(1);
    const again = stubClient();
    const second = await segmentBook({ outDir, book: 'bk', client: again, concurrency: 1, pages });
    expect(again.calls).toHaveLength(0);
    expect(second.items).toHaveLength(1);
  });

  it('模型切分走行号，题面不经模型改写', async () => {
    const outDir = tempDir();
    const pages = new Map<number, string>([[1, '[页眉] 第一章 实数集\n§1 实数\n3. 证明 $a>0$。\n证 这是一段足够长的证明。']]);
    const client = stubClient({
      segment: () =>
        JSON.stringify({
          boundaries: [
            { line: '1:1', kind: 'section' },
            { line: '1:2', kind: 'exercise', no: '3', solutionLine: '1:3' },
          ],
        }),
    });
    const result = await segmentBook({ outDir, book: 'bk', client, concurrency: 1, pages });
    expect(result.modelWindows).toBe(1);
    expect(result.items[0]).toMatchObject({ statement: '3. 证明 $a>0$。', solution: '证 这是一段足够长的证明。', sectionNo: 1 });
  });
});

describe('候选过滤', () => {
  const base: SegmentedItem = {
    id: 'x',
    book: 'a',
    chapterNo: 1,
    chapter: '第一章',
    volume: '上',
    sectionNo: 1,
    section: '',
    itemType: 'exercise',
    itemNo: '1',
    statement: '设 $x>0$，证明 $x+1>1$。',
    analysis: '',
    solution: `证 ${'由 $x>0$ 两边同加 1 得到结论。'.repeat(6)}`,
    pages: [1],
  };

  it('拒绝原因', () => {
    expect(ruleRejectReason(base)).toBeNull();
    expect(ruleRejectReason({ ...base, statement: '求 $x$ 的值。', solution: `解 ${'x'.repeat(100)}` })).toBe('not_proof');
    expect(ruleRejectReason({ ...base, solution: '' })).toBe('no_solution');
    expect(ruleRejectReason({ ...base, solution: '证 显然。' })).toBe('trivial_solution');
    expect(ruleRejectReason({ ...base, statement: '如图 1-3 所示，证明 $x>1$。' })).toBe('needs_figure');
    expect(ruleRejectReason({ ...base, solution: `${base.solution}\n[图]` })).toBe('needs_figure');
    expect(ruleRejectReason({ ...base, statement: '如上题，证明 $x>1$。' })).toBe('refers_other');
    expect(ruleRejectReason({ ...base, statement: '由第 3 题的结论证明 $x>1$。' })).toBe('refers_other');
    expect(ruleRejectReason({ ...base, statement: '证明 ⍰ 成立。' })).toBe('garbled');
    expect(ruleRejectReason({ ...base, solution: `证 ${'长'.repeat(4000)}` })).toBe('too_long');
  });

  it('解答以“证”开头的隐式证明题也算', () => {
    expect(ruleRejectReason({ ...base, statement: '若 $x>0$，则 $x+1>1$。' })).toBeNull();
  });

  it('跨书去重：主书优先；题号和排版差异不影响', () => {
    const items: SegmentedItem[] = [
      { ...base, id: 'a-1', statement: '3. 设 $x>0$，证明 $x+1>1$。' },
      { ...base, id: 'b-1', book: 'b', statement: '○5. 设 $x > 0$, 证明 $x + 1 > 1$.' },
      { ...base, id: 'b-2', book: 'b', statement: '设 $y<0$，证明 $y-1<-1$。这是另一道完全不同的题目。' },
      { ...base, id: 'c-1', chapterNo: 9, statement: '3. 设 $x>0$，证明 $x+1>1$。' },
    ];
    const result = selectCandidates(items);
    expect(result.kept.map((item) => item.id)).toEqual(['a-1', 'b-2', 'c-1']);
    expect(result.rejected).toEqual([{ id: 'b-1', reason: 'duplicate', note: 'a-1' }]);
    expect(dedupeKey('3. 设 $x>0$，证明')).toBe(dedupeKey('○5. 设 $x > 0$, 证明'));
  });
});
