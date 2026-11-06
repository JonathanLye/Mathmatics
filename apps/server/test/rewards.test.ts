import { describe, expect, it } from 'vitest';

import {
  BLANK_REWARD_STATE,
  computeRewards,
  keySource,
  sourceKeysFor,
  type RewardContext,
  type RewardState,
} from '../src/progress/rewards.ts';
import { addDays, computeStreak, shanghaiDay, weekStart } from '../src/progress/streak.ts';

const ctx = (over: Partial<RewardContext> = {}): RewardContext => ({
  problemId: 'epsN',
  kind: 'main',
  day: '2026-11-05',
  existingKeys: new Set(),
  dailyDone: false,
  keysTodayBefore: 0,
  dailyGoal: 3,
  streakIfActive: 1,
  earnedBadges: new Set(),
  chapterCleared: false,
  ...over,
});

const state = (over: Partial<RewardState> = {}): RewardState => ({ ...BLANK_REWARD_STATE, ...over });

describe('computeRewards 规则表', () => {
  const cases: Array<{
    name: string;
    before: RewardState;
    after: RewardState;
    ctx?: Partial<RewardContext>;
    rows: Array<[string, number]>;
    daily: boolean;
    xp: number;
  }> = [
    { name: '没有变化：什么都没有', before: state(), after: state(), rows: [], daily: false, xp: 0 },
    {
      name: '独立写出一个关键步骤 +10，今天第一次 +5',
      before: state(),
      after: state({ matched: ['K1'] }),
      rows: [['key_own', 10]],
      daily: true,
      xp: 15,
    },
    {
      name: '用过 H2 以上提示才写出 +3',
      before: state(),
      after: state({ matched: ['K1'], hinted: ['K1'] }),
      rows: [['key_hinted', 3]],
      daily: true,
      xp: 8,
    },
    {
      name: '今天已经发过每日首次：不再发',
      before: state(),
      after: state({ matched: ['K1'] }),
      ctx: { dailyDone: true },
      rows: [['key_own', 10]],
      daily: false,
      xp: 10,
    },
    {
      name: '一次写出两个关键步骤，一个独立一个借助提示',
      before: state({ matched: ['K1'] }),
      after: state({ matched: ['K1', 'K2', 'K3'], hinted: ['K3'] }),
      rows: [
        ['key_own', 10],
        ['key_hinted', 3],
      ],
      daily: true,
      xp: 18,
    },
    {
      name: '完成一层 +5（跳过的层不计）',
      before: state({ layerStatus: { 1: 'skip' } }),
      after: state({ layerStatus: { 1: 'skip', 2: 'skip', 3: 'done' } }),
      rows: [['layer', 5]],
      daily: true,
      xp: 10,
    },
    {
      name: '完成一题 +20（含最后一层 +5）',
      before: state({ layerStatus: { 3: 'done' } }),
      after: state({ done: true, layerStatus: { 3: 'done', 6: 'done' } }),
      rows: [
        ['layer', 5],
        ['problem', 20],
      ],
      daily: true,
      xp: 30,
    },
    {
      name: '行数、提示本身不给分：只有 reveal 变化没有经验',
      before: state(),
      after: state({ reveal: 1 }),
      rows: [],
      daily: false,
      xp: 0,
    },
    {
      name: '来源键已存在（重做/重放）：不重复发，也没有每日首次',
      before: state(),
      after: state({ matched: ['K1'], layerStatus: { 3: 'done' }, done: true }),
      ctx: {
        kind: 'redo',
        existingKeys: new Set(['key:epsN:K1', 'layer:epsN:L3', 'done:epsN']),
      },
      rows: [],
      daily: false,
      xp: 0,
    },
    {
      name: '测验结算：before 取空白，完成时一次发齐',
      before: BLANK_REWARD_STATE,
      after: state({ done: true, matched: ['K1', 'K2'], layerStatus: { 3: 'done', 6: 'done' } }),
      rows: [
        ['key_own', 10],
        ['key_own', 10],
        ['layer', 5],
        ['layer', 5],
        ['problem', 20],
      ],
      daily: true,
      xp: 55,
    },
    {
      name: '看过思路（approach）：之后写出的关键步骤按借助提示档',
      before: state(),
      after: state({ matched: ['K1'] }),
      ctx: { solutionRevealLevel: 'approach' },
      rows: [['key_hinted', 3]],
      daily: true,
      xp: 8,
    },
    {
      name: '看过完整题解（full）：关键步骤没有经验，层与题照常',
      before: state(),
      after: state({ matched: ['K1'], layerStatus: { 3: 'done' } }),
      ctx: { solutionRevealLevel: 'full' },
      rows: [['layer', 5]],
      daily: true,
      xp: 10,
    },
  ];

  it.each(cases)('$name', ({ before, after, ctx: over, rows, daily, xp }) => {
    const result = computeRewards(before, after, ctx(over));
    expect(result.rows.map((r) => [r.kind, r.amount])).toEqual(rows);
    expect(result.dailyRow !== null).toBe(daily);
    expect(result.xp).toBe(xp);
  });

  it('来源键由题 + 步骤/层组成，不含作答 ID（重做用同一个键）', () => {
    const result = computeRewards(state(), state({ matched: ['K2'], layerStatus: { 1: 'done' } }), ctx());
    expect(result.rows.map((r) => r.sourceKey)).toEqual([keySource('epsN', 'K2'), 'layer:epsN:L1']);
    expect(sourceKeysFor('epsN', ['K1', 'K2'])).toContain('key:epsN:K2');
    expect(sourceKeysFor('epsN', ['K1'])).toContain('done:epsN');
  });

  it('纯函数：同样的输入得到同样的输出，且不修改入参', () => {
    const before = state();
    const after = state({ matched: ['K1'], done: true });
    const c = ctx();
    const a = computeRewards(before, after, c);
    const b = computeRewards(before, after, c);
    expect(a).toEqual(b);
    expect(before).toEqual(state());
  });
});

describe('computeRewards 徽章', () => {
  const finish = state({ done: true, matched: ['K1'], layerStatus: { 3: 'done', 6: 'done' } });

  it('第一步 / 独立写出 / 证完一道 / 无提示通关', () => {
    const r = computeRewards(state(), finish, ctx());
    expect(r.badges).toEqual(['first_step', 'own_write', 'first_done', 'no_hint_clear']);
  });

  it('已经有的徽章不再发', () => {
    const r = computeRewards(state(), finish, ctx({ earnedBadges: new Set(['first_step', 'own_write', 'first_done', 'no_hint_clear']) }));
    expect(r.badges).toEqual([]);
  });

  it('用过提示或透露量 > 0：没有无提示通关', () => {
    expect(computeRewards(state(), { ...finish, reveal: 0.5 }, ctx()).badges).not.toContain('no_hint_clear');
    expect(computeRewards(state(), { ...finish, hinted: ['K1'] }, ctx()).badges).not.toContain('no_hint_clear');
    expect(computeRewards(state(), { ...finish, overrides: 1 }, ctx()).badges).not.toContain('no_hint_clear');
  });

  it('看过题解（approach/full）：没有无提示通关', () => {
    expect(computeRewards(state(), finish, ctx({ solutionRevealLevel: 'approach' })).badges).not.toContain('no_hint_clear');
    expect(computeRewards(state(), finish, ctx({ solutionRevealLevel: 'full' })).badges).not.toContain('no_hint_clear');
  });

  it('重做成功：重做完成时发；重做不发证完一道，也不发经验', () => {
    const r = computeRewards(state(), finish, ctx({ kind: 'redo', existingKeys: new Set(sourceKeysFor('epsN', ['K1'])) }));
    expect(r.xp).toBe(0);
    expect(r.badges).toEqual(['no_hint_clear', 'redo_success']);
  });

  it('单元通关：只在主作答完成且单元都完成时发', () => {
    expect(computeRewards(state(), finish, ctx({ chapterCleared: true })).badges).toContain('unit_clear');
    expect(computeRewards(state(), finish, ctx({ chapterCleared: false })).badges).not.toContain('unit_clear');
  });

  it.each([
    [2, []],
    [3, ['streak_3']],
    [7, ['streak_3', 'streak_7']],
    [30, ['streak_3', 'streak_7', 'streak_30']],
  ])('连续 %i 天', (days, expected) => {
    const r = computeRewards(state(), state({ matched: ['K1'] }), ctx({ streakIfActive: days, earnedBadges: new Set(['first_step', 'own_write']) }));
    expect(r.badges).toEqual(expected);
  });

  it('今日目标：本步让关键步骤数跨过目标时 goalReached，且只发一次', () => {
    const r = computeRewards(state(), state({ matched: ['K1', 'K2'] }), ctx({ keysTodayBefore: 1 }));
    expect(r.goalReached).toBe(true);
    expect(r.badges).toContain('daily_goal');
    const again = computeRewards(state({ matched: ['K1', 'K2'] }), state({ matched: ['K1', 'K2', 'K3'] }), ctx({ keysTodayBefore: 3 }));
    expect(again.goalReached).toBe(false);
  });
});

describe('连胜（Asia/Shanghai）', () => {
  it('上海午夜边界：UTC 15:59 与 16:00 分属两天', () => {
    expect(shanghaiDay(Date.parse('2026-11-05T15:59:59Z'))).toBe('2026-11-05');
    expect(shanghaiDay(Date.parse('2026-11-05T16:00:00Z'))).toBe('2026-11-06');
    expect(shanghaiDay(Date.parse('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });

  it('周一起算的周', () => {
    expect(weekStart('2026-11-02')).toBe('2026-11-02'); // 周一
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // 周日
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('没有记录：0', () => {
    expect(computeStreak([], '2026-11-05')).toEqual({ current: 0, best: 0, freezeAvailable: true, usedFreezeDays: [] });
  });

  it('连续几天；今天还没练习不算断', () => {
    expect(computeStreak(['2026-11-03', '2026-11-04'], '2026-11-05').current).toBe(2);
    expect(computeStreak(['2026-11-03', '2026-11-04', '2026-11-05'], '2026-11-05').current).toBe(3);
  });

  it('漏一天：本周的请假卡自动补上，连胜不断也不增加', () => {
    // 2026-11-02 周一 ... 周三没练，周四练
    const s = computeStreak(['2026-11-02', '2026-11-03', '2026-11-05'], '2026-11-05');
    expect(s).toMatchObject({ current: 3, usedFreezeDays: ['2026-11-04'], freezeAvailable: false });
  });

  it('同一周漏两天：第二天断了', () => {
    const s = computeStreak(['2026-11-02', '2026-11-05'], '2026-11-06');
    // 周二用卡，周三（11-04）同一周没卡了 -> 断；周四重新计 1，周五（今天）还没练
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
    expect(s.usedFreezeDays).toEqual([]);
  });

  it('每周一张：跨周各有一张', () => {
    // 周日 11-08 漏（周卡 11-02 周），下周一 11-09 起新的一周又有一张
    const s = computeStreak(['2026-11-07', '2026-11-09', '2026-11-10'], '2026-11-10');
    expect(s.current).toBe(3);
    expect(s.usedFreezeDays).toEqual(['2026-11-08']);
    expect(s.freezeAvailable).toBe(true);
  });

  it('断了之后重新开始；最好成绩保留', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    const s = computeStreak([...days, '2026-11-05'], '2026-11-05');
    expect(s.current).toBe(1);
    expect(s.best).toBe(4);
  });
});
