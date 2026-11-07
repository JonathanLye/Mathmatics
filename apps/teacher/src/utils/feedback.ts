// 反馈收件箱（15 号文档 §9）的纯逻辑：状态与分类的说法、查询串、改状态前的校验、探针上下文的展示行。
// 上下文来自学生端（不可信）：这里只产出纯文本，页面一律用 {{ }} 渲染，不用 v-html。
import type { FeedbackCategory, FeedbackCloseReason, FeedbackContext, FeedbackStatus } from '../api/types.ts';

export const STATUS_ORDER: readonly FeedbackStatus[] = ['new', 'open', 'need_info', 'resolved', 'closed'];

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: '新反馈',
  open: '处理中',
  need_info: '待补充',
  resolved: '已解决',
  closed: '已关闭',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as FeedbackStatus] ?? status;
}

export function statusTheme(status: string): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  if (status === 'new') return 'danger';
  if (status === 'open') return 'primary';
  if (status === 'need_info') return 'warning';
  if (status === 'resolved') return 'success';
  return 'default';
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: '功能故障',
  display: '显示异常',
  content: '题目有误',
  suggestion: '建议',
  question: '咨询',
  other: '其他',
};

export const CATEGORY_OPTIONS: Array<{ label: string; value: FeedbackCategory }> = (Object.keys(CATEGORY_LABELS) as FeedbackCategory[]).map(
  (value) => ({ label: CATEGORY_LABELS[value], value }),
);

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return '未分类';
  return CATEGORY_LABELS[category as FeedbackCategory] ?? category;
}

const KIND_LABELS: Record<string, string> = { bug: '有问题', idea: '有想法', content: '题目有误', other: '其他' };
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

const CLOSE_LABELS: Record<FeedbackCloseReason, string> = {
  fixed: '已修复',
  duplicate: '重复',
  wontfix: '暂不处理',
  no_repro: '无法复现',
};
export const CLOSE_REASON_OPTIONS: Array<{ label: string; value: FeedbackCloseReason }> = (Object.keys(CLOSE_LABELS) as FeedbackCloseReason[]).map(
  (value) => ({ label: CLOSE_LABELS[value], value }),
);
export const closeReasonLabel = (reason: string | null | undefined): string => (reason ? (CLOSE_LABELS[reason as FeedbackCloseReason] ?? reason) : '');

/** 页面区域：服务端按路由推导，这里给筛选下拉用。 */
export const AREA_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '路径', value: 'home' },
  { label: '练习', value: 'practice-zone' },
  { label: '做题', value: 'practice' },
  { label: '错题', value: 'mistakes' },
  { label: '证明本', value: 'proofbook' },
  { label: '证明详情', value: 'proof-detail' },
  { label: '我的', value: 'me' },
  { label: '出错页', value: 'not-found' },
  { label: '其他', value: 'other' },
];
export function areaLabel(area: string | null | undefined): string {
  if (!area) return '—';
  return AREA_OPTIONS.find((o) => o.value === area)?.label ?? area;
}

export const PAGE_SIZE = 30;

/** 收件箱的查询串。空的筛选项不带；关键词最长 80。 */
export function buildInboxQuery(opts: { status?: string; category?: string; area?: string; unread?: boolean; q?: string; offset?: number; limit?: number }): string {
  const params = new URLSearchParams({ limit: String(opts.limit ?? PAGE_SIZE), offset: String(Math.max(0, opts.offset ?? 0)) });
  if (opts.status) params.set('status', opts.status);
  if (opts.category) params.set('category', opts.category);
  if (opts.area) params.set('area', opts.area);
  if (opts.unread === true) params.set('unread', 'true');
  const q = opts.q?.trim();
  if (q) params.set('q', q.slice(0, 80));
  return params.toString();
}

export interface StatusChange {
  status: FeedbackStatus;
  closeReason?: FeedbackCloseReason | undefined;
  note: string;
}

/** 改成已解决/已关闭前的校验（和服务端的 422 一致，先在表单里拦住）。返回错误提示，没有问题返回 null。 */
export function validateStatusChange(change: StatusChange): string | null {
  const note = change.note.trim();
  if ((change.status === 'resolved' || change.status === 'closed') && note === '') return '请写一句说明，学生会在信箱里看到';
  if (change.status === 'closed' && !change.closeReason) return '关闭时要选一个原因';
  if (note.length > 2000) return '说明太长了（最多 2000 字）';
  return null;
}

/** 「确认复现」按钮能不能点，以及不能点的原因。 */
export function confirmBlockedReason(item: { category?: string | null; confirmed: boolean }): string | null {
  if (item.confirmed) return '已经确认过了';
  if (item.category !== 'bug' && item.category !== 'display') return '先把分类设为「功能故障」或「显示异常」';
  return null;
}

export interface ContextRow {
  label: string;
  value: string;
}

/** 探针上下文 → 若干「名称：值」行（纯文本）。没有的字段不出现。 */
export function contextRows(ctx: FeedbackContext | null | undefined): ContextRow[] {
  if (!ctx) return [];
  const rows: ContextRow[] = [];
  const add = (label: string, value: unknown): void => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ label, value: String(value) });
  };
  add('页面', [ctx.pageName, ctx.route].filter(Boolean).join(' · '));
  add('题目', ctx.problemId);
  add('作答', ctx.attemptId);
  add('层', ctx.layer);
  add('模式', ctx.mode === 'test' ? '测验' : ctx.mode === 'practice' ? '练习' : undefined);
  add('第几步', ctx.stepNo);
  add('圈到的元素', ctx.targets?.join('、'));
  add('版本', [ctx.app?.version, ctx.app?.sha?.slice(0, 7)].filter(Boolean).join(' · '));
  const env = ctx.env;
  if (env) {
    add('系统与浏览器', [env.os, env.browser].filter(Boolean).join(' · '));
    add('视口', env.viewport ? `${env.viewport}${env.dpr ? ` @${env.dpr}x` : ''}` : undefined);
    add('外观与网络', [env.theme === 'dark' ? '深色' : env.theme === 'light' ? '浅色' : '', env.online === false ? '离线' : env.online === true ? '在线' : '', env.motion === false ? '动效关' : ''].filter(Boolean).join(' · '));
  }
  return rows;
}

/** 最近的操作：一行一条，纯文本。 */
export function breadcrumbLines(ctx: FeedbackContext | null | undefined): string[] {
  return (ctx?.breadcrumbs ?? []).map((b) => {
    const tail = [b.status ? String(b.status) : '', typeof b.ms === 'number' ? `${b.ms}ms` : '', b.reqId ?? ''].filter(Boolean).join(' ');
    return `${b.kind === 'nav' ? '打开' : b.kind === 'tap' ? '点击' : '请求'} ${b.text}${tail ? `  ${tail}` : ''}`;
  });
}

export function errorLines(ctx: FeedbackContext | null | undefined): string[] {
  return (ctx?.errors ?? []).map((e) => `${e.name ? `${e.name}: ` : ''}${e.message}${e.where ? `  (${e.where})` : ''}`);
}

/** 服务端错误码 → 开发者看得懂的提示。 */
export function feedbackErrorMessage(code: string | undefined, fallback: string): string {
  if (code === 'FEEDBACK_CLOSED') return '这条已经关闭，先把状态改回「处理中」再回复';
  return fallback;
}
