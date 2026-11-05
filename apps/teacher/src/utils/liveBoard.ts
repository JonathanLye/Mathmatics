import type { LiveRow } from '../api/types.ts';

/** 看板瓦片的状态色（紧急度从高到低）。口径：help=需要你；stuck=卡住≥3 分钟；away=离开；write=在写；done=已完成；idle=未开始。 */
export type Tone = 'help' | 'stuck' | 'away' | 'write' | 'done' | 'idle';

export const STUCK_SEC = 180;
const URGENCY: Record<Tone, number> = { help: 0, stuck: 1, away: 2, write: 3, idle: 4, done: 5 };

export function toneOf(row: LiveRow): Tone {
  const flags = row.flags ?? [];
  if (row.status === 'completed') return 'done';
  if (row.status === 'not_started' || row.attemptId === null) return 'idle';
  if (row.status === 'locked' || flags.includes('help') || flags.includes('budget_exhausted')) return 'help';
  if ((row.stuckSec ?? 0) >= STUCK_SEC) return 'stuck';
  if (row.status === 'away') return 'away';
  return 'write';
}

export function sortRows(rows: LiveRow[]): LiveRow[] {
  return [...rows].sort((a, b) => {
    const diff = URGENCY[toneOf(a)] - URGENCY[toneOf(b)];
    if (diff !== 0) return diff;
    // 同档里卡得越久越靠前
    return (b.stuckSec ?? 0) - (a.stuckSec ?? 0) || a.anonCode.localeCompare(b.anonCode);
  });
}

/** L1..L6 → 1..6；完成 → 7；未开始 → 0。 */
export function layerIndex(row: LiveRow): number {
  if (row.status === 'completed') return 7;
  const m = /^L([1-6])$/.exec(row.layer ?? '');
  return m ? Number(m[1]) : 0;
}

export function minutes(sec: number | undefined): number {
  return Math.max(0, Math.floor((sec ?? 0) / 60));
}

/** 瓦片底部一句话：只陈述事实（卡在哪、多久、离开几次），不下结论。 */
export function footText(row: LiveRow): string {
  const tone = toneOf(row);
  const flags = row.flags ?? [];
  const where = row.currentKeyLabel ? `卡在「${row.currentKeyLabel}」` : '';
  if (tone === 'help') {
    if (row.status === 'locked') return '作答已锁定，等你处理';
    const head = flags.includes('budget_exhausted') ? '额度已用尽' : '发出了求助';
    return [head, where, minutes(row.stuckSec) > 0 ? `${minutes(row.stuckSec)} 分钟` : ''].filter(Boolean).join(' · ');
  }
  if (tone === 'stuck') return [where || '没有新的关键步骤', `${minutes(row.stuckSec)} 分钟没有进展`].join(' · ');
  if (tone === 'away') return `现在不在页面${row.awayCount ? ` · 已离开 ${row.awayCount} 次` : ''}`;
  if (tone === 'done') return `已完成 · 自己写出 ${row.keysOwn ?? 0} / ${row.keysTotal ?? 0}`;
  if (tone === 'idle') return '还没有打开';
  const flagged = flags.includes('integrity') ? ' · 有诚信提醒' : '';
  return `${row.layer ?? ''} 在写${flagged}`.trim();
}

export interface BoardStats {
  needs: number;
  stuck: number;
  write: number;
  away: number;
  done: number;
  idle: number;
  total: number;
}

export function boardStats(rows: LiveRow[]): BoardStats {
  const out: BoardStats = { needs: 0, stuck: 0, write: 0, away: 0, done: 0, idle: 0, total: rows.length };
  for (const row of rows) {
    const tone = toneOf(row);
    if (tone === 'help') out.needs += 1;
    else if (tone === 'stuck') out.stuck += 1;
    else if (tone === 'away') out.away += 1;
    else if (tone === 'write') out.write += 1;
    else if (tone === 'done') out.done += 1;
    else out.idle += 1;
  }
  return out;
}

export type BoardFilter = Tone | null;

export function filterRows(rows: LiveRow[], filter: BoardFilter): LiveRow[] {
  return filter === null ? rows : rows.filter((row) => toneOf(row) === filter);
}
