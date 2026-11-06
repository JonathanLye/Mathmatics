export type ProblemStatus = 'draft' | 'pending' | 'returned' | 'published' | 'retired';

const LABELS: Record<ProblemStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  returned: '已退回',
  published: '已发布',
  retired: '已停用',
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

export const PAGE_SIZE = 25;

/** 题库列表的查询串：筛选 + 分页。空的筛选项不带。 */
export function buildListQuery(opts: { status?: string; reviewSource?: string; q?: string; cursor?: string | null; limit?: number }): string {
  const params = new URLSearchParams({ limit: String(opts.limit ?? PAGE_SIZE) });
  if (opts.status) params.set('status', opts.status);
  if (opts.reviewSource) params.set('reviewSource', opts.reviewSource);
  const q = (opts.q ?? '').trim().slice(0, 60);
  if (q !== '') params.set('q', q);
  if (opts.cursor) params.set('cursor', opts.cursor);
  return params.toString();
}

/** 来源标签：老师审核 / AI 整理（批量导入、AI 整理，上线前由老师抽检）。 */
export function sourceLabel(source: string | null | undefined): string {
  return source === 'auto' ? 'AI 整理' : '老师审核';
}
