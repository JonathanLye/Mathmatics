import { describe, expect, it } from 'vitest';

import { formatCount, formatRate, formatSeconds, independenceBand, keyHeatRows, layerFunnelData } from './metrics.ts';

describe('指标展示', () => {
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

  it('层漏斗按六层固定顺序、用中文层名，缺省为 0', () => {
    expect(layerFunnelData({ L3: 3, L1: 1 })).toEqual([
      { name: '回忆定义', value: 1 },
      { name: '搭骨架', value: 0 },
      { name: '写证明', value: 3 },
      { name: '自检', value: 0 },
      { name: '换题试试', value: 0 },
      { name: '总结', value: 0 },
    ]);
  });

  it('关键步骤卡点行：保序、缺省为 0、total=own+viaHint', () => {
    expect(keyHeatRows(undefined)).toEqual([]);
    expect(keyHeatRows([{ key: 'K1', own: 2, viaHint: 1 }, { label: '取 N', own: Number.NaN }])).toEqual([
      { label: 'K1', own: 2, viaHint: 1, total: 3 },
      { label: '取 N', own: 0, viaHint: 0, total: 0 },
    ]);
  });
});
