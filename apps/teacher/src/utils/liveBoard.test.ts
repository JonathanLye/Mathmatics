import { describe, expect, it } from 'vitest';

import type { LiveRow } from '../api/types.ts';
import { boardStats, filterRows, footText, layerIndex, sortRows, toneOf } from './liveBoard.ts';

const row = (patch: Partial<LiveRow>): LiveRow => ({ anonCode: 'S-A', attemptId: 'a1', status: 'active', layer: 'L3', ...patch }) as LiveRow;

describe('liveBoard', () => {
  it('toneOf：求助/额度用尽/锁定 > 卡住 > 离开 > 在写；完成与未开始单列', () => {
    expect(toneOf(row({ flags: ['help'] }))).toBe('help');
    expect(toneOf(row({ flags: ['budget_exhausted'] }))).toBe('help');
    expect(toneOf(row({ status: 'locked' }))).toBe('help');
    expect(toneOf(row({ stuckSec: 200 }))).toBe('stuck');
    expect(toneOf(row({ stuckSec: 179 }))).toBe('write');
    expect(toneOf(row({ status: 'away' }))).toBe('away');
    expect(toneOf(row({ status: 'away', stuckSec: 400 }))).toBe('stuck');
    expect(toneOf(row({ status: 'completed', flags: ['help'] }))).toBe('done');
    expect(toneOf(row({ status: 'not_started', attemptId: null }))).toBe('idle');
  });

  it('sortRows：按紧急度，同档卡得久的在前，已完成沉底', () => {
    const rows = [
      row({ anonCode: 'S-DONE', status: 'completed' }),
      row({ anonCode: 'S-WRITE' }),
      row({ anonCode: 'S-STUCK1', stuckSec: 240 }),
      row({ anonCode: 'S-STUCK2', stuckSec: 600 }),
      row({ anonCode: 'S-HELP', flags: ['help'] }),
      row({ anonCode: 'S-IDLE', status: 'not_started', attemptId: null }),
    ];
    expect(sortRows(rows).map((r) => r.anonCode)).toEqual(['S-HELP', 'S-STUCK2', 'S-STUCK1', 'S-WRITE', 'S-IDLE', 'S-DONE']);
  });

  it('boardStats / filterRows 口径一致', () => {
    const rows = [row({ flags: ['help'] }), row({ stuckSec: 300 }), row({}), row({ status: 'completed' }), row({ status: 'not_started', attemptId: null })];
    expect(boardStats(rows)).toEqual({ needs: 1, stuck: 1, write: 1, away: 0, done: 1, idle: 1, total: 5 });
    expect(filterRows(rows, 'stuck')).toHaveLength(1);
    expect(filterRows(rows, null)).toHaveLength(5);
  });

  it('layerIndex：L1..L6 → 1..6，完成 7，未开始 0', () => {
    expect(layerIndex(row({ layer: 'L4' }))).toBe(4);
    expect(layerIndex(row({ status: 'completed' }))).toBe(7);
    expect(layerIndex(row({ layer: null, status: 'not_started', attemptId: null }))).toBe(0);
  });

  it('footText 只陈述事实', () => {
    expect(footText(row({ flags: ['budget_exhausted'], currentKeyLabel: '取 N', stuckSec: 540 }))).toBe('额度已用尽 · 卡在「取 N」 · 9 分钟');
    expect(footText(row({ stuckSec: 360, currentKeyLabel: '放缩' }))).toBe('卡在「放缩」 · 6 分钟没有进展');
    expect(footText(row({ status: 'away', awayCount: 2 }))).toBe('现在不在页面 · 已离开 2 次');
    expect(footText(row({ status: 'not_started', attemptId: null }))).toBe('还没有打开');
  });
});
