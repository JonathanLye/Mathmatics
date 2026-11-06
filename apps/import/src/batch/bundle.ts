import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { ProblemPackage } from '@proof-gym/engine';

import type { DraftOutcome } from './draft-stage.ts';
import type { SegmentedItem } from './segment.ts';
import { bandOf, type Band } from './verify.ts';

// 把通过门禁的题打成一个 bundle.jsonl.gz：第一行是头，然后是单元，再是题。
// 服务端 import-bundle 从标准输入读它。路径上每节最多 5 题；所有题都进练习区。
export const COURSE = { id: 'math-analysis', title: '数学分析' };
export const PATH_ITEMS_PER_SECTION = 5;
// 单元号从 100 起，避开种子题占用的单元号。
const UNIT_NO_OFFSET = 100;

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

export function contentHash(pkg: ProblemPackage): string {
  return createHash('sha256')
    .update(stable({ id: pkg.id, kind: pkg.kind, public: pkg.public, secret: pkg.secret }))
    .digest('hex');
}

export interface BundleHeader {
  type: 'header';
  batchId: string;
  createdAt: string;
  course: { id: string; title: string };
  problems: number;
  units: number;
}

export interface BundleUnit {
  type: 'unit';
  chapterNo: number;
  unitNo: number;
  title: string;
  summary: string;
  conceptIds: string[];
  sort: number;
  items: string[];
}

export interface BundleProblem {
  type: 'problem';
  contentHash: string;
  quality: number;
  band: Band;
  pathEligible: boolean;
  unit: { chapterNo: number; unitNo: number };
  pkg: ProblemPackage;
}

export type BundleLine = BundleHeader | BundleUnit | BundleProblem;

const BAND_ORDER: Record<Band, number> = { easy: 0, medium: 1, hard: 2 };

export interface BundleInput {
  batchId: string;
  outcomes: readonly DraftOutcome[];
  itemOf: (partId: string) => SegmentedItem;
  now?: Date;
}

export function buildBundle(input: BundleInput): BundleLine[] {
  const passing = input.outcomes.filter((outcome) => outcome.ok && outcome.pkg !== undefined);
  const groups = new Map<string, { chapterNo: number; unitNo: number; chapter: string; section: string; members: DraftOutcome[] }>();
  for (const outcome of passing) {
    const item = input.itemOf(outcome.partId);
    const unitNo = UNIT_NO_OFFSET + item.sectionNo;
    const key = `${item.chapterNo}:${unitNo}`;
    const group = groups.get(key) ?? { chapterNo: item.chapterNo, unitNo, chapter: item.chapter, section: item.section, members: [] };
    group.members.push(outcome);
    groups.set(key, group);
  }

  const units: BundleUnit[] = [];
  const problems: BundleProblem[] = [];
  const ordered = [...groups.values()].sort((a, b) => a.chapterNo - b.chapterNo || a.unitNo - b.unitNo);
  for (const group of ordered) {
    // 由易到难，同档质量高的在前：质量分低的自然排到单元末尾。
    const members = [...group.members].sort((a, b) => {
      const bandA = bandOf((a.pkg as ProblemPackage).public.difficulty);
      const bandB = bandOf((b.pkg as ProblemPackage).public.difficulty);
      return BAND_ORDER[bandA] - BAND_ORDER[bandB] || (b.quality ?? 0) - (a.quality ?? 0) || a.problemId.localeCompare(b.problemId);
    });
    const onPath = pathPick(members);
    const pathIds = new Set(onPath.map((member) => member.problemId));
    for (const member of members) {
      const pkg = member.pkg as ProblemPackage;
      problems.push({
        type: 'problem',
        contentHash: contentHash(pkg),
        quality: member.quality ?? 0,
        band: bandOf(pkg.public.difficulty),
        pathEligible: pathIds.has(member.problemId),
        unit: { chapterNo: group.chapterNo, unitNo: group.unitNo },
        pkg,
      });
    }
    const concepts = [...new Set(onPath.flatMap((member) => (member.pkg as ProblemPackage).public.concepts ?? []))];
    const title = group.section === '' ? group.chapter : group.section;
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const member of members) counts[bandOf((member.pkg as ProblemPackage).public.difficulty)] += 1;
    units.push({
      type: 'unit',
      chapterNo: group.chapterNo,
      unitNo: group.unitNo,
      title,
      summary: `${group.chapter}：本节练习区有 ${members.length} 道证明题（入门 ${counts.easy}、进阶 ${counts.medium}、挑战 ${counts.hard}）。`,
      conceptIds: concepts,
      sort: group.chapterNo * 1000 + group.unitNo,
      items: onPath.map((member) => member.problemId),
    });
  }
  const header: BundleHeader = {
    type: 'header',
    batchId: input.batchId,
    createdAt: (input.now ?? new Date()).toISOString(),
    course: COURSE,
    problems: problems.length,
    units: units.length,
  };
  return [header, ...units, ...problems];
}

// 路径挑题：尽量每档都有，保持由易到难；不够 5 题就全上。
function pathPick(sorted: readonly DraftOutcome[]): DraftOutcome[] {
  if (sorted.length <= PATH_ITEMS_PER_SECTION) return [...sorted];
  const picked: DraftOutcome[] = [];
  const bands: Band[] = ['easy', 'medium', 'hard'];
  const byBand = new Map<Band, DraftOutcome[]>(
    bands.map((band) => [band, sorted.filter((member) => bandOf((member.pkg as ProblemPackage).public.difficulty) === band)]),
  );
  while (picked.length < PATH_ITEMS_PER_SECTION) {
    let progressed = false;
    for (const band of bands) {
      const next = byBand.get(band)?.shift();
      if (next !== undefined && picked.length < PATH_ITEMS_PER_SECTION) {
        picked.push(next);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  const order = new Map(sorted.map((member, index) => [member.problemId, index]));
  return picked.sort((a, b) => (order.get(a.problemId) ?? 0) - (order.get(b.problemId) ?? 0));
}

export function encodeBundle(lines: readonly BundleLine[]): Buffer {
  return gzipSync(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, { level: 9 });
}

export function decodeBundle(buffer: Buffer): BundleLine[] {
  const text = (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer).toString('utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as BundleLine);
}
