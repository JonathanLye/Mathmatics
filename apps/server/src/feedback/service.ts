import type { Db, Queryable, TxQueryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { areaOf, sanitizeContext } from './context.ts';

// 反馈信箱（15-反馈与信箱.md）。学生侧与开发者侧共用这个模块；路由在 routes/feedback.ts。
// 状态：new 已收到 → open 正在看 → need_info 想问问你 → resolved 已解决 → closed 已关闭。

export type FeedbackKind = 'bug' | 'idea' | 'content' | 'other';
export type FeedbackStatus = 'new' | 'open' | 'need_info' | 'resolved' | 'closed';
export type FeedbackCategory = 'bug' | 'display' | 'content' | 'suggestion' | 'question' | 'other';
export type CloseReason = 'fixed' | 'duplicate' | 'wontfix' | 'no_repro';

export const BUG_HUNTER_BADGE = 'bug_hunter';
export const REOPEN_WINDOW_DAYS = 14;
export const CONFIRM_DEFAULT_NOTE = '我们复现了这个问题，正在处理。谢谢你帮小方抓到它！';
const PREVIEW_CHARS = 60;
const LIST_LIMIT = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const feedbackIdOf = (value: string): string => {
  if (!UUID.test(value)) throw new AppError('NOT_FOUND', 404, '这条反馈不存在');
  return value;
};

const iso = (value: unknown): string => new Date(value as string | Date).toISOString();
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));
const preview = (text: string): string => Array.from(text).slice(0, PREVIEW_CHARS).join('');

interface FeedbackRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ref_no: number;
  kind: FeedbackKind;
  body: string;
  page: string | null;
  status: FeedbackStatus;
  category: FeedbackCategory | null;
  area: string | null;
  context: Record<string, unknown>;
  student_unread: boolean;
  dev_unread: boolean;
  student_event: 'confirmed' | 'resolved' | null;
  created_at: Date;
  last_activity_at: Date;
  confirmed_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  close_reason: CloseReason | null;
  resolution_note: string | null;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  author_role: 'student' | 'dev';
  body: string;
  created_at: Date;
}

const messagesOf = async (db: Queryable, feedbackId: string): Promise<MessageRow[]> =>
  (
    await db.query<MessageRow>(
      `select id, author_role, body, created_at from app.feedback_messages where feedback_id = $1 order by created_at, id`,
      [feedbackId],
    )
  ).rows;

// ---------------------------------------------------------------- 学生侧

export interface SubmitInput {
  kind: FeedbackKind;
  body: string;
  page?: string;
  context?: unknown;
}

export async function submitFeedback(db: Queryable, userId: string, input: SubmitInput): Promise<{ id: string; refNo: number }> {
  const text = input.body.trim();
  if (text.length < 1) throw new AppError('VALIDATION_FAILED', 422, '请写一点内容再提交');
  const context = sanitizeContext(input.context);
  const route = typeof context.route === 'string' ? context.route : input.page;
  const page = input.page ?? (typeof context.route === 'string' ? context.route : null);
  const row = (
    await db.query<{ id: string; ref_no: number }>(
      `insert into app.student_feedback (user_id, kind, body, page, context, area)
       values ($1, $2, $3, $4, $5::jsonb, $6) returning id, ref_no`,
      [userId, input.kind, text, page, JSON.stringify(context), areaOf(route)],
    )
  ).rows[0];
  if (!row) throw new Error('insert student_feedback 没有返回行');
  return { id: row.id, refNo: row.ref_no };
}

export async function countStudentUnread(db: Queryable, userId: string): Promise<number> {
  const r = await db.query<{ n: number | string }>(
    `select count(*)::int as n from app.student_feedback where user_id = $1 and student_unread`,
    [userId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export async function listMyFeedback(db: Queryable, userId: string) {
  const rows = (
    await db.query<FeedbackRow & { last_reply: string | null }>(
      `select f.*,
              (select m.body from app.feedback_messages m
                where m.feedback_id = f.id and m.author_role = 'dev'
                order by m.created_at desc, m.id desc limit 1) as last_reply
         from app.student_feedback f
        where f.user_id = $1
        order by f.last_activity_at desc, f.id
        limit ${LIST_LIMIT}`,
      [userId],
    )
  ).rows;
  return {
    items: rows.map((r) => ({
      id: r.id,
      refNo: r.ref_no,
      kind: r.kind,
      status: r.status,
      closeReason: r.close_reason,
      preview: preview(r.body),
      lastReply: r.last_reply === null ? null : preview(r.last_reply),
      confirmed: r.confirmed_at !== null,
      unread: r.student_unread,
      createdAt: iso(r.created_at),
      lastActivityAt: iso(r.last_activity_at),
    })),
    unread: await countStudentUnread(db, userId),
  };
}

export async function getMyFeedback(db: Db, userId: string, feedbackId: string) {
  return db.tx(async (tx) => {
    const row = (
      await tx.query<FeedbackRow>(`select * from app.student_feedback where id = $1 and user_id = $2 for update`, [feedbackId, userId])
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '这条反馈不存在');
    const messages = await messagesOf(tx, row.id);
    // 读后清掉红点与一次性庆祝事件：同一事件只会在第一次打开时返回。
    await tx.query(`update app.student_feedback set student_unread = false, student_event = null where id = $1`, [row.id]);
    return {
      id: row.id,
      refNo: row.ref_no,
      kind: row.kind,
      status: row.status,
      closeReason: row.close_reason,
      confirmed: row.confirmed_at !== null,
      event: row.student_event,
      createdAt: iso(row.created_at),
      messages: [
        { id: row.id, from: 'me' as const, body: row.body, createdAt: iso(row.created_at) },
        ...messages.map((m) => ({ id: m.id, from: m.author_role === 'student' ? ('me' as const) : ('dev' as const), body: m.body, createdAt: iso(m.created_at) })),
      ],
    };
  });
}

export async function replyMyFeedback(db: Db, userId: string, feedbackId: string, body: string) {
  const text = body.trim();
  if (text.length < 1) throw new AppError('VALIDATION_FAILED', 422, '请写一点内容再发送');
  return db.tx(async (tx) => {
    const row = (
      await tx.query<FeedbackRow>(`select * from app.student_feedback where id = $1 and user_id = $2 for update`, [feedbackId, userId])
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '这条反馈不存在');
    if (row.status === 'closed') throw new AppError('FEEDBACK_CLOSED', 409, '这条反馈已经关闭了，可以再写一条新的');
    let status: FeedbackStatus = row.status;
    if (row.status === 'resolved') {
      const ageMs = Date.now() - new Date(row.resolved_at ?? row.last_activity_at).getTime();
      if (ageMs > REOPEN_WINDOW_DAYS * 86_400_000) throw new AppError('FEEDBACK_CLOSED', 409, '这条反馈已经过了追问的时间，可以再写一条新的');
      status = 'open';
    } else if (row.status === 'need_info') {
      status = 'open';
    }
    const msg = (
      await tx.query<MessageRow>(
        `insert into app.feedback_messages (feedback_id, author_role, author_id, body) values ($1, 'student', $2, $3)
         returning id, author_role, body, created_at`,
        [row.id, userId, text],
      )
    ).rows[0];
    if (!msg) throw new Error('insert feedback_messages 没有返回行');
    await tx.query(
      `update app.student_feedback
          set status = $2, dev_unread = true, last_activity_at = now(),
              resolved_at = case when $2 = 'open' then null else resolved_at end,
              student_event = case when $2 = 'open' then null else student_event end
        where id = $1`,
      [row.id, status],
    );
    return { id: msg.id, from: 'me' as const, body: msg.body, createdAt: iso(msg.created_at) };
  });
}

// ---------------------------------------------------------------- 开发者侧（仅 admin）

export const STATUSES: readonly FeedbackStatus[] = ['new', 'open', 'need_info', 'resolved', 'closed'];
export const CATEGORIES: readonly FeedbackCategory[] = ['bug', 'display', 'content', 'suggestion', 'question', 'other'];
export const CLOSE_REASONS: readonly CloseReason[] = ['fixed', 'duplicate', 'wontfix', 'no_repro'];

export interface InboxQuery {
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  area?: string;
  unread?: boolean;
  q?: string;
  limit: number;
  offset: number;
}

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listInbox(db: Queryable, query: InboxQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace('$?', `$${params.length}`));
  };
  if (query.status) add('f.status = $?', query.status);
  if (query.category) add('f.category = $?', query.category);
  if (query.area) add('f.area = $?', query.area);
  if (query.unread === true) where.push('f.dev_unread');
  if (query.q) add(`f.body ilike $? escape '\\'`, `%${likeEscape(query.q)}%`);
  const clause = where.length > 0 ? `where ${where.join(' and ')}` : '';

  const rows = (
    await db.query<FeedbackRow & { anon_code: string; class_name: string | null }>(
      `select f.*, u.anon_code,
              (select c.name from app.class_members m join app.classes c on c.id = m.class_id
                where m.user_id = f.user_id and m.left_at is null order by c.created_at limit 1) as class_name
         from app.student_feedback f join app.users u on u.id = f.user_id
         ${clause}
        order by f.dev_unread desc, f.last_activity_at desc, f.id
        limit ${Math.trunc(query.limit)} offset ${Math.trunc(query.offset)}`,
      params,
    )
  ).rows;
  const total = Number((await db.query<{ n: number | string }>(`select count(*)::int as n from app.student_feedback f ${clause}`, params)).rows[0]?.n ?? 0);
  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of (await db.query<{ status: string; n: number | string }>(`select status, count(*)::int as n from app.student_feedback group by status`)).rows) {
    counts[r.status] = Number(r.n);
  }
  return {
    items: rows.map((r) => ({
      id: r.id,
      refNo: r.ref_no,
      kind: r.kind,
      category: r.category,
      area: r.area,
      status: r.status,
      preview: preview(r.body),
      anonCode: r.anon_code,
      className: r.class_name,
      confirmed: r.confirmed_at !== null,
      devUnread: r.dev_unread,
      createdAt: iso(r.created_at),
      lastActivityAt: iso(r.last_activity_at),
    })),
    total,
    counts,
  };
}

async function loadDetail(db: Queryable, feedbackId: string) {
  const row = (
    await db.query<FeedbackRow & { anon_code: string }>(
      `select f.*, u.anon_code from app.student_feedback f join app.users u on u.id = f.user_id where f.id = $1`,
      [feedbackId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '这条反馈不存在');
  const classNames = (
    await db.query<{ name: string }>(
      `select c.name from app.class_members m join app.classes c on c.id = m.class_id
        where m.user_id = $1 and m.left_at is null order by c.created_at`,
      [row.user_id],
    )
  ).rows.map((r) => r.name);
  const messages = await messagesOf(db, row.id);
  return {
    id: row.id,
    refNo: row.ref_no,
    kind: row.kind,
    category: row.category,
    area: row.area,
    status: row.status,
    closeReason: row.close_reason,
    resolutionNote: row.resolution_note,
    anonCode: row.anon_code,
    classNames,
    page: row.page,
    confirmed: row.confirmed_at !== null,
    confirmedAt: isoOrNull(row.confirmed_at),
    createdAt: iso(row.created_at),
    lastActivityAt: iso(row.last_activity_at),
    context: row.context,
    messages: [
      { id: row.id, from: 'student' as const, body: row.body, createdAt: iso(row.created_at) },
      ...messages.map((m) => ({ id: m.id, from: m.author_role, body: m.body, createdAt: iso(m.created_at) })),
    ],
  };
}

export async function getInboxItem(db: Db, feedbackId: string) {
  return db.tx(async (tx) => {
    const detail = await loadDetail(tx, feedbackId);
    await tx.query(`update app.student_feedback set dev_unread = false where id = $1 and dev_unread`, [feedbackId]);
    return detail;
  });
}

const lockRow = async (tx: TxQueryable, feedbackId: string): Promise<FeedbackRow> => {
  const row = (await tx.query<FeedbackRow>(`select * from app.student_feedback where id = $1 for update`, [feedbackId])).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '这条反馈不存在');
  return row;
};

const addDevMessage = async (tx: TxQueryable, feedbackId: string, adminId: string, body: string): Promise<void> => {
  await tx.query(`insert into app.feedback_messages (feedback_id, author_role, author_id, body) values ($1, 'dev', $2, $3)`, [feedbackId, adminId, body]);
};

export interface InboxPatch {
  category?: FeedbackCategory;
  area?: string;
  status?: FeedbackStatus;
  closeReason?: CloseReason;
  note?: string;
}

export async function patchInboxItem(db: Db, adminId: string, feedbackId: string, patch: InboxPatch) {
  return db.tx(async (tx) => {
    const row = await lockRow(tx, feedbackId);
    const note = patch.note?.trim() ?? '';

    if (patch.closeReason !== undefined && patch.status !== 'closed') {
      throw new AppError('VALIDATION_FAILED', 422, '只有关闭时才需要选关闭原因');
    }
    if (patch.status === 'closed' && patch.closeReason === undefined) {
      throw new AppError('VALIDATION_FAILED', 422, '关闭时要选一个原因');
    }
    if ((patch.status === 'resolved' || patch.status === 'closed') && note === '') {
      throw new AppError('VALIDATION_FAILED', 422, '请写一句说明，学生会在信箱里看到');
    }

    if (patch.category !== undefined || patch.area !== undefined) {
      await tx.query(`update app.student_feedback set category = coalesce($2, category), area = coalesce($3, area) where id = $1`, [
        row.id,
        patch.category ?? null,
        patch.area?.trim() || null,
      ]);
    }

    if (patch.status !== undefined && patch.status !== row.status) {
      const to = patch.status;
      if (to === 'resolved') {
        await tx.query(
          `update app.student_feedback set status = 'resolved', resolved_at = now(), closed_at = null, close_reason = null,
                  resolution_note = $2, student_event = 'resolved', student_unread = true, last_activity_at = now() where id = $1`,
          [row.id, note],
        );
        await addDevMessage(tx, row.id, adminId, note);
      } else if (to === 'closed') {
        await tx.query(
          `update app.student_feedback set status = 'closed', closed_at = now(), close_reason = $2,
                  resolution_note = $3, student_unread = true, last_activity_at = now() where id = $1`,
          [row.id, patch.closeReason, note],
        );
        await addDevMessage(tx, row.id, adminId, note);
      } else {
        // 回到 new/open/need_info：清掉结单信息。
        await tx.query(
          `update app.student_feedback set status = $2, resolved_at = null, closed_at = null, close_reason = null,
                  student_unread = true, last_activity_at = now() where id = $1`,
          [row.id, to],
        );
        if (note !== '') await addDevMessage(tx, row.id, adminId, note);
      }
    }
    return loadDetail(tx, row.id);
  });
}

export async function replyInboxItem(db: Db, adminId: string, feedbackId: string, input: { body: string; setStatus?: 'need_info' | 'resolved' }) {
  const text = input.body.trim();
  if (text.length < 1) throw new AppError('VALIDATION_FAILED', 422, '请写一点内容再发送');
  return db.tx(async (tx) => {
    const row = await lockRow(tx, feedbackId);
    if (row.status === 'closed') throw new AppError('FEEDBACK_CLOSED', 409, '这条反馈已经关闭，先改回「正在看」再回复');
    await addDevMessage(tx, row.id, adminId, text);
    let status: FeedbackStatus = row.status === 'new' ? 'open' : row.status;
    if (input.setStatus) status = input.setStatus;
    const resolving = input.setStatus === 'resolved';
    await tx.query(
      `update app.student_feedback
          set status = $2, student_unread = true, dev_unread = false, last_activity_at = now(),
              resolved_at = case when $3 then now() else resolved_at end,
              resolution_note = case when $3 then $4 else resolution_note end,
              student_event = case when $3 then 'resolved' else student_event end
        where id = $1`,
      [row.id, status, resolving, text],
    );
    return loadDetail(tx, row.id);
  });
}

export async function confirmFeedbackBug(
  db: Db,
  adminId: string,
  feedbackId: string,
  note: string | undefined,
): Promise<{ confirmed: true; badgeGranted: boolean }> {
  return db.tx(async (tx) => {
    const row = await lockRow(tx, feedbackId);
    if (row.category !== 'bug' && row.category !== 'display') {
      throw new AppError('VALIDATION_FAILED', 422, '先把分类设为「功能故障」或「显示异常」再确认复现');
    }
    if (row.confirmed_at !== null) return { confirmed: true as const, badgeGranted: false };
    await tx.query(
      `update app.student_feedback
          set confirmed_at = now(), student_event = 'confirmed', student_unread = true, last_activity_at = now(),
              status = case when status = 'new' then 'open' else status end
        where id = $1`,
      [row.id],
    );
    await addDevMessage(tx, row.id, adminId, note?.trim() || CONFIRM_DEFAULT_NOTE);
    const granted = await tx.query(
      `insert into app.student_badges (user_id, badge_id) values ($1, $2) on conflict (user_id, badge_id) do nothing returning badge_id`,
      [row.user_id, BUG_HUNTER_BADGE],
    );
    return { confirmed: true as const, badgeGranted: granted.rows.length > 0 };
  });
}
