import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BudgetExceededError } from './ledger.ts';
import { mapPool, parseJsonLoose, type ChatClient, providerOf } from './llm.ts';
import { writeAtomic } from './ocr-stage.ts';

// S4 切条目：模型只标边界（行号），不改写内容，所以题面保真；条目结束位置 = 下一个边界的前一行，
// 这样跨页拼接是自然结果。模型失败时退回规则切分。
export const SEGMENT_MODEL = 'deepseek-flash';

export type BoundaryKind = 'exercise' | 'example' | 'exam' | 'section' | 'chapter' | 'other';

export interface PageLine {
  id: string;
  page: number;
  no: number;
  text: string;
}

export interface Boundary {
  line: string;
  kind: BoundaryKind;
  no?: string;
  solutionLine?: string | null;
  analysisLine?: string | null;
  examSource?: string | null;
}

export interface SegmentedItem {
  id: string;
  book: string;
  chapterNo: number;
  chapter: string;
  volume: '上' | '下';
  sectionNo: number;
  section: string;
  itemType: 'exercise' | 'example' | 'exam';
  itemNo: string;
  statement: string;
  analysis: string;
  solution: string;
  pages: number[];
  examSource?: string;
}

const HEADER = /^\[页眉\]/;
const FOOTER = /^\[页脚\]/;
const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function chineseNumeral(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text);
  if (text === '十') return 10;
  const match = /^([一二三四五六七八九]?)(十?)([一二三四五六七八九]?)$/.exec(text);
  if (match === null || text === '') return null;
  const [, tens, ten, ones] = match;
  if (ten === '') return CN_DIGITS[ones as string] ?? CN_DIGITS[tens as string] ?? null;
  return (tens === '' ? 1 : (CN_DIGITS[tens as string] ?? 1)) * 10 + (ones === '' ? 0 : (CN_DIGITS[ones as string] ?? 0));
}

export interface PageMeta {
  chapterNo: number | null;
  chapter: string | null;
  volume: '上' | '下' | null;
}

const CHAPTER_IN_TEXT = /第\s*([一二三四五六七八九十\d]+)\s*章\s*([^\s·•・\d（(…\.]{1,24})?/;

// 章节来自页眉：奇数页页眉是章名，偶数页页眉是书名（带上/下册），缺的从上一页延续。
export function parseHeader(rawPage: string): PageMeta {
  const header = rawPage.split('\n').find((line) => HEADER.test(line.trim())) ?? '';
  const match = CHAPTER_IN_TEXT.exec(header);
  const chapterNo = match === null ? null : chineseNumeral(match[1] as string);
  const volume = /[(（]\s*上册?\s*[)）]/.test(header) ? '上' : /[(（]\s*下册?\s*[)）]/.test(header) ? '下' : null;
  return {
    chapterNo,
    chapter: match === null || chapterNo === null ? null : `第${match[1] as string}章${match[2] === undefined ? '' : ` ${match[2].trim()}`}`,
    volume,
  };
}

export function pageLines(page: number, text: string): PageLine[] {
  const lines: PageLine[] = [];
  let no = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed === '' || HEADER.test(trimmed) || FOOTER.test(trimmed)) continue;
    no += 1;
    lines.push({ id: `${page}:${no}`, page, no, text: trimmed });
  }
  return lines;
}

// —— 规则切分（模型失败时兜底，也用于单测）——
// “(1)” 小题不是条目；“1.” 只有在编号正好接上当前节的上一题时才算，证明内部的分步编号不切。
const EXERCISE_START = /^[○◎●☆★△▲*＊]?\s*(\d{1,3})\s*[.．、]\s*\S/;
const EXERCISE_NAMED = /^(?:习题|第)\s*(\d+(?:\.\d+)?)\s*(?:题)?[.．、:：\s]/;
const EXAMPLE_START = /^(?:【\s*例\s*(\d+(?:\.\d+)?)\s*】|例题?\s*(\d+(?:\.\d+)?)[.．、:：\s])/;
const EXAM_START = /^【\s*题\s*(\d+(?:\.\d+)?)\s*】\s*(?:[（(]([^）)]*)[）)])?/;
const SECTION_START = /^(?:\$\\S\s*(\d+)\$|§\s*(\d+))\s*(.*)$/;
const CHAPTER_START = /^第\s*[一二三四五六七八九十\d]+\s*章/;
const COLUMN_START = /^(?:知识要点|内容提要|典型例题|历年考研真题评析|课后习题全解|习题详解|目录)\s*$/;
const SOLUTION_START = /^(?:\*\*)?(?:证明|证|解题过程|解析过程|解答|解)(?:\*\*)?\s*(?:[:：.．]|\s|\(|（|$)/;
const ANALYSIS_START = /^(?:\*\*)?(?:解题分析|分析)(?:\*\*)?\s*(?:[:：.．]|\s|$)/;

export function boundariesByRule(lines: readonly PageLine[]): Boundary[] {
  const out: Boundary[] = [];
  let lastNo = 0;
  let current: Boundary | null = null;
  for (const line of lines) {
    const text = line.text;
    const section = SECTION_START.exec(text);
    if (section !== null || COLUMN_START.test(text)) {
      out.push({ line: line.id, kind: section !== null ? 'section' : 'other' });
      current = null;
      lastNo = 0;
      continue;
    }
    if (CHAPTER_START.test(text) && text.length < 30) {
      out.push({ line: line.id, kind: 'chapter' });
      current = null;
      lastNo = 0;
      continue;
    }
    const exam = EXAM_START.exec(text);
    if (exam !== null) {
      current = { line: line.id, kind: 'exam', no: exam[1] as string, solutionLine: null, analysisLine: null, examSource: exam[2] ?? null };
      out.push(current);
      continue;
    }
    const example = EXAMPLE_START.exec(text);
    if (example !== null) {
      current = { line: line.id, kind: 'example', no: (example[1] ?? example[2]) as string, solutionLine: null, analysisLine: null };
      out.push(current);
      continue;
    }
    const named = EXERCISE_NAMED.exec(text);
    const numbered = EXERCISE_START.exec(text);
    const no = named?.[1] ?? numbered?.[1];
    // 证明内部的“1. 2.”分步：已经进入解答、且编号没有接上就不切。
    const continues = no !== undefined && Number(no) === lastNo + 1;
    if (no !== undefined && (named !== null || continues || current === null || current.solutionLine === null)) {
      if (named !== null || continues || lastNo === 0) {
        lastNo = Number(no);
        current = { line: line.id, kind: 'exercise', no, solutionLine: null, analysisLine: null };
        out.push(current);
        continue;
      }
    }
    if (current !== null) {
      if (current.solutionLine === null && SOLUTION_START.test(text)) current.solutionLine = line.id;
      else if (current.analysisLine === null && current.solutionLine === null && ANALYSIS_START.test(text)) current.analysisLine = line.id;
    }
  }
  return out;
}

// —— 模型切分 ——
export const SEGMENT_SYSTEM = [
  '下面是数学教辅的 OCR 文本，每行开头是行号（页:行）。你只标出条目边界，不改写任何内容。',
  '边界类型 kind：',
  '- exercise：编号习题，如“○1.”“◎2.”“3.”“第 3 题”“习题 2.1”；',
  '- example：例题，如“【例 3】”“例 3”；',
  '- exam：考研真题，如“【题 2.1】（北京大学，2003）”，examSource 填括号里的学校和年份；',
  '- section：节标题，如“§2 连续函数的性质”；chapter：章标题；',
  '- other：其它不属于题目的块的开始，如“知识要点”“内容提要”“目录”“典型例题”“课后习题全解”。',
  '要点：',
  '1. “(1)”“(2)”这样的小题不是单独条目，属于它上面的编号条目。证明或解答内部的“1. 2.”分步也不是条目。',
  '2. solutionLine 是这个条目解答开始的那一行（以“证”“证明”“解”“解题过程”“解析过程”开头）；analysisLine 是“分析”“解题分析”那一行。解答不在本窗口内就写 null。',
  '3. 窗口开头可能是上一页延续下来的解答，不要为它输出边界。',
  '4. 按出现顺序输出，line、solutionLine、analysisLine 必须是文本里真实存在的行号。',
  '只输出 JSON：{"boundaries":[{"line":"12:3","kind":"exercise","no":"3","solutionLine":"12:5","analysisLine":null,"examSource":null}]}',
].join('\n');

export interface WindowSpec {
  start: number;
  pages: number[];
}

export function windowsOf(pages: readonly number[], size = 3, step = 2): WindowSpec[] {
  const windows: WindowSpec[] = [];
  for (let index = 0; index < pages.length; index += step) {
    windows.push({ start: pages[index] as number, pages: pages.slice(index, index + size) as number[] });
    if (index + size >= pages.length) break;
  }
  return windows;
}

const KINDS = new Set<BoundaryKind>(['exercise', 'example', 'exam', 'section', 'chapter', 'other']);

export function parseBoundaries(text: string, known: ReadonlySet<string>): Boundary[] {
  const parsed = parseJsonLoose<{ boundaries?: unknown }>(text);
  if (!Array.isArray(parsed.boundaries)) throw new Error('切分结果缺 boundaries');
  const out: Boundary[] = [];
  for (const raw of parsed.boundaries as Array<Record<string, unknown>>) {
    const line = typeof raw.line === 'string' ? raw.line : '';
    const kind = raw.kind as BoundaryKind;
    if (!known.has(line) || !KINDS.has(kind)) continue;
    const pick = (value: unknown): string | null => (typeof value === 'string' && known.has(value) ? value : null);
    out.push({
      line,
      kind,
      ...(raw.no === undefined || raw.no === null ? {} : { no: String(raw.no) }),
      solutionLine: pick(raw.solutionLine),
      analysisLine: pick(raw.analysisLine),
      examSource: typeof raw.examSource === 'string' ? raw.examSource : null,
    });
  }
  return out;
}

export interface WindowResult {
  start: number;
  pages: number[];
  source: 'model' | 'rule';
  boundaries: Boundary[];
  error?: string;
}

const lineKey = (id: string): [number, number] => {
  const [page, no] = id.split(':');
  return [Number(page), Number(no)];
};

export function compareLineIds(a: string, b: string): number {
  const [pa, na] = lineKey(a);
  const [pb, nb] = lineKey(b);
  return pa - pb || na - nb;
}

// 合并窗口：每一页以“这一页是核心页”的窗口为准（步长内的页）；解答行号从任一窗口补全。
export function mergeWindows(results: readonly WindowResult[], step = 2): Boundary[] {
  const merged = new Map<string, Boundary>();
  const sorted = [...results].sort((a, b) => a.start - b.start);
  for (const result of sorted) {
    const core = new Set(result.pages.slice(0, step));
    for (const boundary of result.boundaries) {
      const [page] = lineKey(boundary.line);
      if (core.has(page)) merged.set(boundary.line, { ...boundary });
    }
  }
  for (const result of sorted) {
    for (const boundary of result.boundaries) {
      const existing = merged.get(boundary.line);
      if (existing === undefined) continue;
      existing.solutionLine ??= boundary.solutionLine ?? null;
      existing.analysisLine ??= boundary.analysisLine ?? null;
    }
  }
  return [...merged.values()].sort((a, b) => compareLineIds(a.line, b.line));
}

function joinLines(lines: readonly PageLine[]): string {
  return lines.map((line) => line.text).join('\n');
}

const SECTION_TITLE = /^(?:\$\\S\s*(\d+)\$|§\s*(\d+))\s*(.*)$/;
const SUBPART_START = /^[（(]\s*\d+\s*[)）]/;

export interface StitchInput {
  book: string;
  lines: readonly PageLine[];
  metas: ReadonlyMap<number, PageMeta>;
  boundaries: readonly Boundary[];
}

const TYPE_CODE: Record<SegmentedItem['itemType'], string> = { exercise: 'e', example: 'x', exam: 'k' };

export function stitchItems(input: StitchInput): SegmentedItem[] {
  const index = new Map(input.lines.map((line, position) => [line.id, position]));
  const items: SegmentedItem[] = [];
  const pagesWithMeta = [...input.metas.keys()].sort((a, b) => a - b);
  const metaAt = (page: number): { chapterNo: number; chapter: string; volume: '上' | '下' } => {
    let chapterNo = 0;
    let chapter = '';
    let volume: '上' | '下' | null = null;
    for (const candidate of pagesWithMeta) {
      if (candidate > page) break;
      const meta = input.metas.get(candidate) as PageMeta;
      if (meta.chapterNo !== null && meta.chapter !== null) {
        // 页眉 OCR 偶尔漏章名后缀：同一章保留更长的那个。
        if (meta.chapterNo !== chapterNo || meta.chapter.length >= chapter.length) chapter = meta.chapter;
        chapterNo = meta.chapterNo;
      }
      if (meta.volume !== null) volume = meta.volume;
    }
    return { chapterNo, chapter, volume: volume ?? (chapterNo >= 12 ? '下' : '上') };
  };

  // 模型偶尔把翻页后的“(1)”小题当成新条目：它只是上一题的延续，这个边界不算。
  const boundaries = input.boundaries.filter((boundary) => {
    if (boundary.kind !== 'exercise') return true;
    const position = index.get(boundary.line);
    return position === undefined || !SUBPART_START.test(input.lines[position]?.text ?? '');
  });

  let sectionNo = 0;
  let section = '';
  let lastChapterNo = 0;
  const seen = new Map<string, number>();
  boundaries.forEach((boundary, position) => {
    const startIndex = index.get(boundary.line);
    if (startIndex === undefined) return;
    const meta0 = metaAt(lineKey(boundary.line)[0]);
    if (meta0.chapterNo !== lastChapterNo) {
      lastChapterNo = meta0.chapterNo;
      sectionNo = 0;
      section = '';
    }
    const startText = input.lines[startIndex]?.text ?? '';
    if (boundary.kind === 'section') {
      const match = SECTION_TITLE.exec(startText);
      sectionNo = Number(match?.[1] ?? match?.[2] ?? sectionNo + 1);
      section = (match?.[3] ?? startText)
        .trim()
        .replace(/[.…]+\s*[（(]?\d*[)）]?$/, '')
        .trim()
        .replace(/(?<=[一-鿿])\s+(?=[一-鿿])/g, '');
      return;
    }
    if (boundary.kind === 'other') {
      // 例题、真题栏目没有 § 标题：栏目名本身就是分组依据。
      if (/典型例题|历年考研真题/.test(startText)) {
        section = startText.replace(/\s+/g, '');
        sectionNo = /典型例题/.test(startText) ? 90 : 91;
      }
      return;
    }
    if (boundary.kind === 'chapter') return;

    const next = boundaries[position + 1];
    const nextIndex = next === undefined ? input.lines.length : (index.get(next.line) ?? input.lines.length);
    const span = input.lines.slice(startIndex, nextIndex);
    const solutionIndex = boundary.solutionLine ? index.get(boundary.solutionLine) : undefined;
    const analysisIndex = boundary.analysisLine ? index.get(boundary.analysisLine) : undefined;
    const inside = (value: number | undefined): value is number => value !== undefined && value > startIndex && value < nextIndex;
    const solutionStart = inside(solutionIndex) ? solutionIndex : -1;
    const analysisStart = inside(analysisIndex) && (solutionStart < 0 || (analysisIndex as number) < solutionStart) ? (analysisIndex as number) : -1;
    const statementEnd = analysisStart >= 0 ? analysisStart : solutionStart >= 0 ? solutionStart : nextIndex;

    const statement = joinLines(input.lines.slice(startIndex, statementEnd));
    const analysis = analysisStart >= 0 ? joinLines(input.lines.slice(analysisStart, solutionStart >= 0 ? solutionStart : nextIndex)) : '';
    const solution = solutionStart >= 0 ? joinLines(input.lines.slice(solutionStart, nextIndex)) : '';
    const pages = [...new Set(span.map((line) => line.page))];
    const itemType = boundary.kind as SegmentedItem['itemType'];
    const itemNo = boundary.no ?? String(position);
    const chapterPart = String(meta0.chapterNo).padStart(2, '0');
    const sectionPart = String(sectionNo).padStart(2, '0');
    const base = `${input.book}-c${chapterPart}-s${sectionPart}-${TYPE_CODE[itemType]}${itemNo.replace(/[^0-9A-Za-z]/g, '_')}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    items.push({
      id: count === 0 ? base : `${base}-d${count}`,
      book: input.book,
      chapterNo: meta0.chapterNo,
      chapter: meta0.chapter,
      volume: meta0.volume,
      sectionNo,
      section,
      itemType,
      itemNo,
      statement,
      analysis,
      solution,
      pages,
      ...(boundary.examSource ? { examSource: boundary.examSource } : {}),
    });
  });
  return items;
}

export interface SegmentOptions {
  outDir: string;
  book: string;
  client: ChatClient;
  concurrency: number;
  pages: Map<number, string>;
  log?: (line: string) => void;
  model?: string;
  useModel?: boolean;
}

// 跑一本书：窗口结果逐个缓存在 segments/<book>/window-NNNN.json。
export async function segmentBook(options: SegmentOptions): Promise<{ items: SegmentedItem[]; modelWindows: number; ruleWindows: number; budgetStopped: boolean }> {
  const dir = join(options.outDir, 'segments', options.book);
  mkdirSync(dir, { recursive: true });
  const pageNumbers = [...options.pages.keys()].sort((a, b) => a - b);
  const allLines = new Map<number, PageLine[]>();
  const metas = new Map<number, PageMeta>();
  for (const page of pageNumbers) {
    const text = options.pages.get(page) as string;
    allLines.set(page, pageLines(page, text));
    metas.set(page, parseHeader(text));
  }
  const windows = windowsOf(pageNumbers);
  const results: WindowResult[] = [];
  let budgetStopped = false;
  await mapPool(
    windows,
    options.concurrency,
    async (window) => {
      const file = join(dir, `window-${String(window.start).padStart(4, '0')}-${window.pages.length}.json`);
      if (existsSync(file)) {
        results.push(JSON.parse(readFileSync(file, 'utf8')) as WindowResult);
        return;
      }
      const lines = window.pages.flatMap((page) => allLines.get(page) ?? []);
      const known = new Set(lines.map((line) => line.id));
      const ruleBoundaries = (): Boundary[] => boundariesByRule(lines);
      let result: WindowResult;
      if (lines.length === 0) {
        result = { start: window.start, pages: window.pages, source: 'rule', boundaries: [] };
      } else if (options.useModel === false) {
        result = { start: window.start, pages: window.pages, source: 'rule', boundaries: ruleBoundaries() };
      } else {
        try {
          const response = await options.client.chat({
            stage: 'segment',
            ref: `${options.book}:${window.start}`,
            provider: providerOf(options.model ?? SEGMENT_MODEL),
            model: options.model ?? SEGMENT_MODEL,
            temperature: 0,
            json: true,
            maxTokens: 4000,
            messages: [
              { role: 'system', content: SEGMENT_SYSTEM },
              { role: 'user', content: lines.map((line) => `${line.id} ${line.text}`).join('\n') },
            ],
          });
          result = { start: window.start, pages: window.pages, source: 'model', boundaries: parseBoundaries(response.text, known) };
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            budgetStopped = true;
            return;
          }
          result = {
            start: window.start,
            pages: window.pages,
            source: 'rule',
            boundaries: ruleBoundaries(),
            error: (error as Error).message.slice(0, 200),
          };
          options.log?.(`[segment] ${options.book} 窗口 ${window.start} 退回规则：${result.error}`);
        }
      }
      writeAtomic(file, `${JSON.stringify(result)}\n`);
      results.push(result);
      if (results.length % 50 === 0) options.log?.(`[segment] ${options.book}: ${results.length}/${windows.length}`);
    },
    () => budgetStopped,
  );
  const boundaries = mergeWindows(results);
  const lines = pageNumbers.flatMap((page) => allLines.get(page) ?? []);
  return {
    items: stitchItems({ book: options.book, lines, metas, boundaries }),
    modelWindows: results.filter((result) => result.source === 'model').length,
    ruleWindows: results.filter((result) => result.source === 'rule').length,
    budgetStopped,
  };
}
