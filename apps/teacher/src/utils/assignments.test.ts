import { describe, expect, it } from 'vitest';

import { defaultsForMode, normalizeAssignmentSettings, parseProofIds } from './assignments.ts';

const base = { mode: 'practice' as const, revealBudget: 2, photoEnabled: true, hintsEnabled: true, maxSwitches: 3, durationMin: 0 };

describe('布置设置归一化（04 §7）', () => {
  it('测验默认关求助/拍照；练习默认开', () => {
    expect(defaultsForMode('test')).toEqual({ photoEnabled: false, hintsEnabled: false });
    expect(defaultsForMode('practice')).toEqual({ photoEnabled: true, hintsEnabled: true });
  });

  it('durationMin 只在测验且 >0 时提交', () => {
    expect(normalizeAssignmentSettings(base)).not.toHaveProperty('durationMin');
    expect(normalizeAssignmentSettings({ ...base, mode: 'test', durationMin: 90 })).toMatchObject({ durationMin: 90 });
    expect(normalizeAssignmentSettings({ ...base, mode: 'test', durationMin: 0 })).not.toHaveProperty('durationMin');
  });

  it('参考证明 ID 解析去重去空', () => {
    expect(parseProofIds(' p1, p2，p1\np3 ')).toEqual(['p1', 'p2', 'p3']);
    expect(parseProofIds('')).toEqual([]);
  });
});
