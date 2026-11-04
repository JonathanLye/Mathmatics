export type ProblemStatus = 'draft' | 'pending' | 'returned' | 'published' | 'retired';

const LABELS: Record<ProblemStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  returned: '已退回',
  published: '已发布',
  retired: '已下线',
};

export function statusLabel(status: string): string {
  return LABELS[status as ProblemStatus] ?? status;
}

export function statusTheme(status: string): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  if (status === 'published') return 'success';
  if (status === 'pending') return 'primary';
  if (status === 'returned') return 'warning';
  if (status === 'retired') return 'danger';
  return 'default';
}

// 自动校验结果（S8）：{ schema: true, katex: true, ... } → 通过/失败摘要；缺失字段不臆造为通过。
export function autoChecksSummary(checks: Record<string, unknown> | undefined): { total: number; failed: string[] } {
  const entries = Object.entries(checks ?? {}).filter(([, value]) => typeof value === 'boolean');
  return { total: entries.length, failed: entries.filter(([, value]) => value !== true).map(([key]) => key) };
}

// 只有草稿/待审/退回的版本可以写审核结论；已发布/已下线/未知状态不可写。
export function canReviewStatus(status: string | null | undefined): boolean {
  return status === 'draft' || status === 'pending' || status === 'returned';
}
