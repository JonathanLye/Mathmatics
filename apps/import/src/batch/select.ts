import type { SegmentedItem } from './segment.ts';
import { bandOf, type Band, type VerifiedPart } from './verify.ts';

// 选题：覆盖每一章，三档比例大致 35/40/25。不够的档由其它档补，不硬凑。
export const BAND_TARGET: Record<Band, number> = { easy: 0.35, medium: 0.4, hard: 0.25 };
const MIN_PER_CHAPTER = 4;

function rank(part: VerifiedPart): number {
  // 把握高、未经修补、长度适中（手机上写得完）的题优先。
  const lengthPenalty = Math.min(1, part.solution.length / 3000) * 0.1;
  return part.verdict.confidence - (part.repaired ? 0.05 : 0) - lengthPenalty;
}

export function selectForDraft(
  verified: readonly VerifiedPart[],
  itemOf: (partId: string) => SegmentedItem,
  target: number,
): VerifiedPart[] {
  const accepted = verified.filter((part) => part.accepted);
  if (accepted.length <= target) return [...accepted];
  const chapters = new Map<number, VerifiedPart[]>();
  for (const part of accepted) {
    const chapterNo = itemOf(part.partId).chapterNo;
    chapters.set(chapterNo, [...(chapters.get(chapterNo) ?? []), part]);
  }
  const floorTotal = [...chapters.values()].reduce((sum, parts) => sum + Math.min(parts.length, MIN_PER_CHAPTER), 0);
  const spare = Math.max(0, target - floorTotal);
  const extraPool = [...chapters.values()].reduce((sum, parts) => sum + Math.max(0, parts.length - MIN_PER_CHAPTER), 0);

  const picked: VerifiedPart[] = [];
  const leftovers: VerifiedPart[] = [];
  for (const parts of chapters.values()) {
    const floor = Math.min(parts.length, MIN_PER_CHAPTER);
    const extra = extraPool === 0 ? 0 : Math.round((Math.max(0, parts.length - MIN_PER_CHAPTER) / extraPool) * spare);
    const quota = Math.min(parts.length, floor + extra);
    const buckets: Record<Band, VerifiedPart[]> = { easy: [], medium: [], hard: [] };
    for (const part of [...parts].sort((a, b) => rank(b) - rank(a))) buckets[bandOf(part.verdict.difficulty)].push(part);
    const chosen: VerifiedPart[] = [];
    for (const band of ['easy', 'medium', 'hard'] as Band[]) {
      const want = Math.round(quota * BAND_TARGET[band]);
      chosen.push(...buckets[band].splice(0, want));
    }
    // 某档不够：用剩下的题按把握补满本章配额。
    const rest = [...buckets.easy, ...buckets.medium, ...buckets.hard].sort((a, b) => rank(b) - rank(a));
    while (chosen.length < quota && rest.length > 0) chosen.push(rest.shift() as VerifiedPart);
    picked.push(...chosen.slice(0, quota));
    leftovers.push(...rest, ...chosen.slice(quota));
  }
  // 四舍五入可能差几题，用剩余题补足。
  if (picked.length < target) {
    picked.push(...leftovers.sort((a, b) => rank(b) - rank(a)).slice(0, target - picked.length));
  }
  return picked.slice(0, target);
}

// 试跑抽样：按章轮转，保证少量样本也覆盖尽可能多的章节。
export function spreadByChapter<T>(items: readonly T[], chapterOf: (item: T) => number, count: number): T[] {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const chapter = chapterOf(item);
    groups.set(chapter, [...(groups.get(chapter) ?? []), item]);
  }
  const chapters = [...groups.keys()].sort((a, b) => a - b);
  const out: T[] = [];
  for (let round = 0; out.length < count; round += 1) {
    let progressed = false;
    for (const chapter of chapters) {
      const group = groups.get(chapter) as T[];
      if (round < group.length && out.length < count) {
        out.push(group[round] as T);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}
