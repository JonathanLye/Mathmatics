import { layerName } from './layers.ts';

// 教师可见的指标口径说明：页面只展示服务端算好的数，不在浏览器里重算。
export const METRIC_EXPLAIN: Record<string, string> = {
  completionRate: '完成率：已完成作答数 / 已开始作答数',
  independenceMedian: '独立度：1 − 提示用掉的额度 / 关键步骤总数。不同题目之间不能比，只用于同一道题比较',
  firstHelpLatency: '首次求助前时长：进入写证明这一层，到第一条计入提示额度的提示。从未领取的不计入',
  postHintDwell: '提示后停留：领取提示到下一行证明之间的时长中位数',
  autonomousCoverage: '自主覆盖率：从来没领过需要计额度的提示的关键步骤 / 关键步骤总数',
  rapidHintEvents: '连点：连续快速点提示被暂时限制的次数',
  integrity: '诚信提醒：信号最高分达到 0.5 的人数。只提醒，不自动处罚',
  layerFunnel: '层漏斗：现在停在每一层的人数',
  keyHeat: '关键步骤卡点：每个关键步骤自己写出 / 经提示写出的人数',
};

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 1000) / 10}%`;
}

export function formatSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.round((value / 60) * 10) / 10}min`;
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}

// 独立度分档：先看 ≥0.85，再看 ≥0.5。
export function independenceBand(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 0.85) return '独立';
  if (value >= 0.5) return '有提示';
  return '依赖';
}

export function layerFunnelData(funnel: Record<string, number> | undefined): Array<{ name: string; value: number }> {
  const source = funnel ?? {};
  return ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((layer) => ({ name: layerName(layer), value: Number(source[layer] ?? 0) }));
}

export interface KeyHeatRow {
  label: string;
  own: number;
  viaHint: number;
  total: number;
}

// 关键步骤卡点：保持服务端顺序；缺省/非有限数按 0；total 用于画条形宽度（口径不重算，只是排版）。
export function keyHeatRows(
  items: ReadonlyArray<{ key?: string; label?: string; own?: number; viaHint?: number }> | undefined,
): KeyHeatRow[] {
  return (items ?? []).map((item) => {
    const own = Number.isFinite(item.own) ? Number(item.own) : 0;
    const viaHint = Number.isFinite(item.viaHint) ? Number(item.viaHint) : 0;
    return { label: String(item.label ?? item.key ?? ''), own, viaHint, total: own + viaHint };
  });
}
