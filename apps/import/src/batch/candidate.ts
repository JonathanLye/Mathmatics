import { canon } from '@proof-gym/engine';

import type { SegmentedItem } from './segment.ts';

// S5 选证明题（规则部分）：只用文本特征筛掉明显不合格的条目，语义判断留给后面的校验模型。
export type RejectReason =
  | 'not_proof'
  | 'no_solution'
  | 'trivial_solution'
  | 'needs_figure'
  | 'refers_other'
  | 'garbled'
  | 'too_long'
  | 'duplicate';

const PROOF_WORD = /证明|试证|求证|验证|prove/i;
const PROOF_SOLUTION = /^(?:\*\*)?(?:证明|证)(?:\*\*)?(?:\s|[:：.．(（]|$)/;
const NEEDS_FIGURE = /\[图\]|如图|见图|图\s*\d+\s*[-－—–.．]\s*\d+|下图|上图|右图|左图/;
const REFERS_OTHER =
  /如上题|上题|前题|前一题|本题\s*\(\d+\)|由第\s*\d+\s*题|第\s*\d+\s*题|习题\s*\d+|例\s*\d+|题\s*\d+\s*(?:的|中|知)|上一节|前一节|书中|教材|课本|(?:定理|公式|命题|引理)\s*\d+(?:\.\d+)?/;
const MIN_SOLUTION_CANON = 60;
const MAX_SOLUTION_CHARS = 3500;

export function ruleRejectReason(item: SegmentedItem): RejectReason | null {
  const proofLike = PROOF_WORD.test(item.statement) || PROOF_SOLUTION.test(item.solution);
  if (!proofLike) return 'not_proof';
  if (item.solution.trim() === '') return 'no_solution';
  if (NEEDS_FIGURE.test(item.statement) || NEEDS_FIGURE.test(item.solution)) return 'needs_figure';
  if (REFERS_OTHER.test(item.statement)) return 'refers_other';
  if (/⍰/.test(item.statement)) return 'garbled';
  const solutionCanon = canon(item.solution);
  if (solutionCanon.length < MIN_SOLUTION_CANON) return 'trivial_solution';
  if (item.solution.length > MAX_SOLUTION_CHARS) return 'too_long';
  return null;
}

// 去重键：canon 之后去掉题号、标点与空白。两本书是同一本教材的习题，重复很多。
export function dedupeKey(statement: string): string {
  const withoutNo = statement.replace(/^[○◎●☆★△▲*＊]?\s*(?:【[^】]*】|\d{1,3}\s*[.．、]|习题\s*\d+(?:\.\d+)?|第\s*\d+\s*题)\s*/, '');
  return canon(withoutNo)
    .replace(/[,.;:，。；：、\s()（）\[\]{}]/g, '')
    .replace(/\\/g, '')
    .toLowerCase();
}

function shingles(text: string, size = 4): Set<string> {
  const out = new Set<string>();
  for (let index = 0; index + size <= text.length; index += 1) out.add(text.slice(index, index + size));
  if (text.length < size) out.add(text);
  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

// 章名以出现最多的写法为准：页眉偶有 OCR 错字或缺后缀，两本书的写法也可能不同，
// 而练习区按章名分组，同一章必须只有一个名字。主书的写法权重更高（books 顺序靠前的先计）。
export function canonicalChapters(items: readonly SegmentedItem[]): Map<number, string> {
  const counts = new Map<number, Map<string, number>>();
  const firstBook = items[0]?.book;
  for (const item of items) {
    if (item.chapterNo === 0 || item.chapter === '') continue;
    const names = counts.get(item.chapterNo) ?? new Map<string, number>();
    names.set(item.chapter, (names.get(item.chapter) ?? 0) + (item.book === firstBook ? 3 : 1));
    counts.set(item.chapterNo, names);
  }
  const best = new Map<number, string>();
  for (const [chapterNo, names] of counts) {
    const [name] = [...names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0] as [string, number];
    best.set(chapterNo, name);
  }
  return best;
}

export interface CandidateResult {
  kept: SegmentedItem[];
  rejected: Array<{ id: string; reason: RejectReason; note?: string }>;
}

// 候选阶段按整条、按章去重；拆成小题之后两本书的小题仍可能相同，页眉漏检导致章号不同时也查不出来。
// 发布前按整理后的题面再查一次：完全相同的都算，近似的只算跨书的（同一本书里的近似题往往是不同的题）。
// 优先留下编号没撞车的（-dN 说明切分时同一节见到了重复题号，多半漏了页眉，章节不可靠），其次按输入顺序。
export function findDuplicateParts(
  entries: ReadonlyArray<{ id: string; book: string; statement: string }>,
  threshold = 0.82,
): Map<string, string> {
  const suspect = (id: string): boolean => /-d\d+(?:-p\d+)?$/.test(id);
  const ordered = [...entries.filter((entry) => !suspect(entry.id)), ...entries.filter((entry) => suspect(entry.id))];
  const seen: Array<{ id: string; book: string; key: string; grams: Set<string> }> = [];
  const duplicates = new Map<string, string>();
  for (const entry of ordered) {
    const key = dedupeKey(entry.statement);
    const grams = shingles(key);
    const twin = seen.find((peer) => peer.key === key || (peer.book !== entry.book && similarity(peer.grams, grams) >= threshold));
    if (twin === undefined) seen.push({ id: entry.id, book: entry.book, key, grams });
    else duplicates.set(entry.id, twin.id);
  }
  return duplicates;
}

// books 的顺序就是优先级：主书在前，副书里重复的题丢掉。
export function selectCandidates(items: readonly SegmentedItem[], threshold = 0.82): CandidateResult {
  const kept: SegmentedItem[] = [];
  const rejected: CandidateResult['rejected'] = [];
  const byChapter = new Map<number, Array<{ item: SegmentedItem; key: string; grams: Set<string> }>>();
  for (const item of items) {
    const reason = ruleRejectReason(item);
    if (reason !== null) {
      rejected.push({ id: item.id, reason });
      continue;
    }
    const key = dedupeKey(item.statement);
    const grams = shingles(key);
    const peers = byChapter.get(item.chapterNo) ?? [];
    const twin = peers.find((peer) => peer.key === key || similarity(peer.grams, grams) >= threshold);
    if (twin !== undefined) {
      rejected.push({ id: item.id, reason: 'duplicate', note: twin.item.id });
      continue;
    }
    peers.push({ item, key, grams });
    byChapter.set(item.chapterNo, peers);
    kept.push(item);
  }
  return { kept, rejected };
}
