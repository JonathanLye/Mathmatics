import { describe, expect, it } from 'vitest';

import { formatCount, formatRate, formatSeconds, independenceBand, layerFunnelData } from './metrics.ts';

describe('指标展示（08 §4 / 04 §3）', () => {
  it('比例与 null', () => {
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(0.3333)).toBe('33.3%');
    expect(formatRate(null)).toBe('—');
  });

  it('时长格式', () => {
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(90)).toBe('1.5min');
    expect(formatSeconds(null)).toBe('—');
    expect(formatCount(3)).toBe('3');
    expect(formatCount(undefined)).toBe('—');
  });

  it('独立度分档边界（先 ≥0.85，再 ≥0.5）', () => {
    expect(independenceBand(0.85)).toBe('独立');
    expect(independenceBand(0.849)).toBe('有提示');
    expect(independenceBand(0.5)).toBe('有提示');
    expect(independenceBand(0.499)).toBe('依赖');
    expect(independenceBand(null)).toBe('—');
  });

  it('层漏斗固定 L1–L6 顺序，缺省为 0', () => {
    expect(layerFunnelData({ L3: 3, L1: 1 })).toEqual([
      { name: 'L1', value: 1 },
      { name: 'L2', value: 0 },
      { name: 'L3', value: 3 },
      { name: 'L4', value: 0 },
      { name: 'L5', value: 0 },
      { name: 'L6', value: 0 },
    ]);
  });
});
