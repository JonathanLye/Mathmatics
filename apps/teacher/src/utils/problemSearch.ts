import { api } from '../api/client.ts';

// 选题下拉用的题目搜索：已发布、未下架的主题，边搜边分页。
export interface ProblemRow {
  problemId: string;
  title: string;
  chapter?: string;
  version: number;
  kind: 'main' | 'transfer';
  hiddenAt?: string;
  reviewSource?: 'teacher' | 'auto';
}

export const PROBLEM_PAGE_SIZE = 20;

export function problemKey(item: Pick<ProblemRow, 'problemId' | 'version'>): string {
  return `${item.problemId}@${item.version}`;
}

export function problemLabel(item: ProblemRow): string {
  return `${item.title}${item.chapter ? ' · ' + item.chapter : ''} · 第 ${item.version} 版`;
}

/** 下架的题不让布置：学生的路径和练习区里也已经看不到它。 */
export function assignable(rows: readonly ProblemRow[]): ProblemRow[] {
  return rows.filter((item) => item.hiddenAt === undefined && item.kind === 'main');
}

export function buildProblemQuery(opts: { q?: string; cursor?: string | null; limit?: number }): string {
  const params = new URLSearchParams({ status: 'published', kind: 'main', limit: String(opts.limit ?? PROBLEM_PAGE_SIZE) });
  const q = (opts.q ?? '').trim().slice(0, 60);
  if (q !== '') params.set('q', q);
  if (opts.cursor) params.set('cursor', opts.cursor);
  return params.toString();
}

export async function fetchProblemPage(opts: { q?: string; cursor?: string | null }): Promise<{ items: ProblemRow[]; nextCursor: string | null }> {
  const page = await api.getPage<ProblemRow[]>(`/api/v1/teacher/problems?${buildProblemQuery(opts)}`);
  return { items: assignable(page.data), nextCursor: page.nextCursor };
}
