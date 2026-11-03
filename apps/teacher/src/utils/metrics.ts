// 08 §4 / 04 §3 的教师可见口径；页面只展示，不重算（04 §3、12 §1）。
export const METRIC_EXPLAIN: Record<string, string> = {
  completionRate: '完成率：已完成作答数 / 已开始作答数（08 §4.2）',
  independenceMedian: '独立度：1 − 透露量 / 关键步骤总数；跨题不可比，只用于同题比较（08 §4.1）',
  firstHelpLatency: '首次求助前时长：进入第 3 层到第一条计透露量提示；从未领取记为删失（08 §4.1）',
  postHintDwell: '提示后停留：领取提示到下一条证明行的时长中位数（08 §4.1）',
  autonomousCoverage: '自主覆盖率：从来没领过 H2 及以上提示的关键步骤 / 关键步骤总数（08 §4.1）',
  rapidHintEvents: '连点：触发连点锁的次数（08 §4.1）',
  integrity: '诚信：信号最高分 ≥0.5 的人数；只提示、不自动处罚（11 §2/§4）',
  layerFunnel: '层漏斗：当前处于每一层的人数（08 §4.2）',
  keyHeat: '关键步骤卡点：每个关键步骤自己写出 / 经提示写出 / 卡在这里的人数（08 §4.2）',
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

// 04 §3：独立度分档（阈值可配置，P0 取 0.85 / 0.5；边界按“先 ≥0.85，再 ≥0.5”实现）。
export function independenceBand(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 0.85) return '独立';
  if (value >= 0.5) return '有提示';
  return '依赖';
}

export function layerFunnelData(funnel: Record<string, number> | undefined): Array<{ name: string; value: number }> {
  const source = funnel ?? {};
  return ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((layer) => ({ name: layer, value: Number(source[layer] ?? 0) }));
}
