import { deserializeState, type SerializedAttemptState } from '@proof-gym/engine';

import type { ContractValidator } from '../contract.ts';
import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

// 证明本（GET /student/notebook）、错题本（GET /student/mistakes）、讲评（GET /attempts/{id}/review）的只读聚合。
// 只读学生自己的、已完成的作答（kind=main|redo）。不产生判断：错因分组来自作答时已经记下的行归类与引擎状态。
// 不读 vault.reference_proofs 以外的任何保密内容；参考证明只在讲评发布后由 loadReview 返回。

export const MISTAKE_GROUPS = [
  { id: 'definition', title: '定义没写全' },
  { id: 'basis', title: '依据缺失' },
  { id: 'scaling', title: '放缩卡住' },
  { id: 'hinted', title: '靠提示写出的步骤' },
  { id: 'selfcheck', title: '自检没通过' },
  { id: 'other', title: '其他卡点' },
] as const;
export type MistakeGroupId = (typeof MISTAKE_GROUPS)[number]['id'];

const NOTEBOOK_CAP = 100;

// 题目包里的错因（secret.errors[].label）→ 分组。关键词映射，覆盖不到的归「其他卡点」。
export function errorGroupOf(label: string): MistakeGroupId {
  if (/依据|引用|定理|适用|条件|前提/.test(label)) return 'basis';
  if (/放缩|不等号|方向|大于|小于|依赖|范围|估计/.test(label)) return 'scaling';
  return 'other';
}

// MathText 截断：不能把 $...$ 从中间截开（否则前端公式渲染出错）。
export function excerpt(text: string, max = 120): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max).join('');
  const dollars = [...cut.matchAll(/(?<!\\)\$/g)];
  if (dollars.length % 2 === 1) cut = cut.slice(0, dollars[dollars.length - 1]?.index ?? cut.length);
  return `${cut.trimEnd()}…`;
}

type AttemptInfo = {
  id: string;
  assignment_id: string;
  problem_id: string;
  problem_version: number;
  kind: 'main' | 'redo';
  parent_attempt_id: string | null;
  mode: 'practice' | 'test';
  state: SerializedAttemptState;
  independence: string | number | null;
  completed_at: Date | string | null;
  started_at: Date | string;
  asg_status: string;
  asg_mode: string;
  open_test: boolean;
  review_published_at: Date | string | null;
  review_note: string | null;
  public: { title?: string; chapter?: string };
  secret: SecretSlice;
};

interface SecretSlice {
  errors?: Array<{ id: string; label: string; question?: string }>;
  def?: {
    components: Array<{ id: string; label: string; missing?: string }>;
    orderQuestion?: string;
  };
}

type LineInfo = {
  id: string;
  attempt_id: string;
  layer: string;
  role: string;
  idx: number;
  slot: string | null;
  statement: string;
  justification: string | null;
  cls: string | null;
  new_keys: string[];
  error_id: string | null;
  created_at: Date | string;
};

const iso = (value: Date | string): string => new Date(value).toISOString();

async function loadAttempts(db: Queryable, userId: string, limit: number): Promise<AttemptInfo[]> {
  return (
    await db.query<AttemptInfo>(
      `select a.id, a.assignment_id, a.problem_id, a.problem_version, a.kind, a.parent_attempt_id, a.mode, a.state,
              a.independence, a.completed_at, a.started_at,
              asg.status as asg_status, asg.mode as asg_mode,
              (asg.mode = 'test' and asg.status in ('scheduled', 'open') and (asg.close_at is null or asg.close_at > now())) as open_test,
              asg.review_published_at, asg.review_note,
              pv.public, ps.secret
         from app.attempts a
         join app.assignments asg on asg.id = a.assignment_id
         join content.problem_versions pv on pv.problem_id = a.problem_id and pv.version = a.problem_version
         join vault.problem_secrets ps on ps.problem_id = a.problem_id and ps.version = a.problem_version
        where a.user_id = $1 and a.kind in ('main', 'redo') and a.status = 'completed'
        order by a.completed_at desc nulls last, a.id
        limit $2`,
      [userId, limit],
    )
  ).rows;
}

async function loadLines(db: Queryable, attemptIds: string[]): Promise<Map<string, LineInfo[]>> {
  const byAttempt = new Map<string, LineInfo[]>();
  if (attemptIds.length === 0) return byAttempt;
  const rows = (
    await db.query<LineInfo>(
      `select id, attempt_id, layer, role, idx, slot, statement, justification, cls, new_keys, error_id, created_at
         from app.attempt_lines
        where attempt_id = any($1::uuid[]) and deleted_at is null
        order by attempt_id, created_at, idx`,
      [attemptIds],
    )
  ).rows;
  for (const row of rows) {
    const list = byAttempt.get(row.attempt_id) ?? [];
    list.push(row);
    byAttempt.set(row.attempt_id, list);
  }
  return byAttempt;
}

interface MistakeItem {
  id: string;
  group: MistakeGroupId;
  problemTitle: string;
  chapter: string;
  attemptId: string;
  lineExcerpt: string;
  note: string;
  createdAt: string;
  canRedo: boolean;
}

// 一次作答里的卡点。测验期间（布置未结束）不出现：测验结束前不给错因反馈（11 §5）。
async function mistakesOf(
  db: Queryable,
  attempt: AttemptInfo,
  lines: LineInfo[],
): Promise<MistakeItem[]> {
  if (attempt.open_test) return [];
  const state = deserializeState(attempt.state);
  const title = attempt.public.title ?? attempt.problem_id;
  const chapter = attempt.public.chapter ?? '';
  const canRedo = !attempt.open_test;
  const when = iso(attempt.completed_at ?? attempt.started_at);
  const out: MistakeItem[] = [];
  const push = (group: MistakeGroupId, ref: string, line: LineInfo | undefined, note: string): void => {
    out.push({
      id: `${attempt.id}:${group}:${ref}`,
      group,
      problemTitle: title,
      chapter,
      attemptId: attempt.id,
      lineExcerpt: line ? excerpt(line.statement) : '',
      note,
      createdAt: line ? iso(line.created_at) : when,
      canRedo,
    });
  };

  // 定义没写全：提交过但没通过（可能跳过了该层）。缺哪几项取最后一次提交的成分结果。
  if (state.def.attempts > 0 && !state.def.passed) {
    const last = (
      await db.query<{ payload: { components?: Record<string, boolean>; orderOk?: boolean } }>(
        `select payload from ev.events where attempt_id = $1 and type = 'def.submit' order by seq desc limit 1`,
        [attempt.id],
      )
    ).rows[0]?.payload;
    const parts = attempt.secret.def?.components ?? [];
    const missing = parts.filter((c) => last?.components?.[c.id] === false).map((c) => c.missing ?? `缺少${c.label}`);
    if (last?.orderOk === false && attempt.secret.def?.orderQuestion) missing.push(attempt.secret.def.orderQuestion);
    const defLine = lines.filter((l) => l.role === 'def').at(-1);
    push('definition', 'def', defLine, missing.length > 0 ? missing.join('') : '定义里还有成分没有写到。');
  }

  // 依据缺失 / 放缩卡住 / 其他：行归类为 error 时记下的错因。
  for (const line of lines) {
    if (line.role !== 'step' || line.cls !== 'error' || !line.error_id) continue;
    const err = attempt.secret.errors?.find((e) => e.id === line.error_id);
    push(errorGroupOf(err?.label ?? ''), line.id, line, err?.question ?? '这一行当时被提了一个问题，回头再想想。');
  }

  // 靠提示写出的步骤：该步最终写出了，但用过 H2 及以上（收费提示）或 H4 示范。
  const hinted = new Set(
    [...state.hint.matched].filter((k) => (state.hint.keyCost[k] ?? 0) > 0 || state.viaHint.includes(k)),
  );
  for (const key of hinted) {
    const line = lines.find((l) => l.role === 'step' && l.new_keys.includes(key));
    push('hinted', key, line, '这一步当时是看了提示才写出来的，试试自己重新写一遍。');
  }

  // 自检没通过：某一问始终没有答到点上。
  const slots = new Map<string, { pass: boolean; last: LineInfo }>();
  for (const line of lines) {
    if (line.role !== 'selfcheck' || !line.slot) continue;
    const prev = slots.get(line.slot);
    slots.set(line.slot, { pass: (prev?.pass ?? false) || line.cls === 'pass', last: line });
  }
  for (const [slot, info] of slots) {
    if (!info.pass) push('selfcheck', slot, info.last, '这一问的回答还没有答到点上。');
  }
  return out;
}

async function redoneParents(db: Queryable, attemptIds: string[]): Promise<Set<string>> {
  if (attemptIds.length === 0) return new Set();
  const rows = (
    await db.query<{ parent_attempt_id: string }>(
      `select distinct parent_attempt_id from app.attempts
        where kind = 'redo' and status = 'completed' and parent_attempt_id = any($1::uuid[])`,
      [attemptIds],
    )
  ).rows;
  return new Set(rows.map((r) => r.parent_attempt_id));
}

// GET /student/mistakes
export async function studentMistakes(db: Db, contract: ContractValidator, userId: string): Promise<Record<string, unknown>> {
  const attempts = await loadAttempts(db, userId, NOTEBOOK_CAP);
  const lines = await loadLines(db, attempts.map((a) => a.id));
  const items: MistakeItem[] = [];
  for (const attempt of attempts) items.push(...(await mistakesOf(db, attempt, lines.get(attempt.id) ?? [])));
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
  const groups = MISTAKE_GROUPS.flatMap((g) => {
    const inGroup = items.filter((i) => i.group === g.id);
    return inGroup.length === 0 ? [] : [{ group: g.id, title: g.title, count: inGroup.length, items: inGroup }];
  });
  const dto = { groups, total: items.length };
  contract.validate('Mistakes', dto);
  return dto;
}

// GET /student/notebook
export async function studentNotebook(db: Db, contract: ContractValidator, userId: string): Promise<Record<string, unknown>> {
  const { cards, toRedo } = await buildNotebook(db, userId);
  const dto = { cards, toRedo };
  contract.validate('Notebook', dto);
  return dto;
}

async function buildNotebook(
  db: Queryable,
  userId: string,
): Promise<{ cards: Record<string, unknown>[]; toRedo: Record<string, unknown>[] }> {
  const attempts = await loadAttempts(db, userId, NOTEBOOK_CAP);
  const lines = await loadLines(db, attempts.map((a) => a.id));
  const redone = await redoneParents(db, attempts.map((a) => a.id));

  // 标准定义只在学生通过第 1 层核验后给：按概念取最新版本。
  const conceptIds = [...new Set(attempts.filter((a) => deserializeState(a.state).def.passed).map((a) => conceptOf(a)))].filter((c) => c !== '');
  const defs = new Map<string, string>();
  if (conceptIds.length > 0) {
    const rows = (
      await db.query<{ id: string; body: { definition?: string } }>(
        `select distinct on (id) id, body from content.concepts where id = any($1::text[]) order by id, version desc`,
        [conceptIds],
      )
    ).rows;
    for (const r of rows) if (typeof r.body.definition === 'string') defs.set(r.id, r.body.definition);
  }

  const cards: Record<string, unknown>[] = [];
  const toRedo: Record<string, unknown>[] = [];
  for (const attempt of attempts) {
    const mine = lines.get(attempt.id) ?? [];
    const state = deserializeState(attempt.state);
    const steps = mine.filter((l) => l.role === 'step');
    const summary = [
      ...mine
        .filter((l) => l.role === 'summary')
        .reduce((bySlot, l) => bySlot.set(Number(l.slot ?? l.idx), l.statement), new Map<number, string>())
        .entries(),
    ]
      .sort(([a], [b]) => a - b)
      .map(([, text]) => text);
    const mistakes = await mistakesOf(db, attempt, mine);
    const weakPoints = MISTAKE_GROUPS.filter((g) => mistakes.some((m) => m.group === g.id)).map((g) => g.title);
    const canRedo = !attempt.open_test;
    const published = attempt.review_published_at !== null;
    const definition = state.def.passed ? defs.get(conceptOf(attempt)) : undefined;

    const card: Record<string, unknown> = {
      attemptId: attempt.id,
      kind: attempt.kind,
      parentAttemptId: attempt.parent_attempt_id,
      assignmentId: attempt.assignment_id,
      problemId: attempt.problem_id,
      title: attempt.public.title ?? attempt.problem_id,
      chapter: attempt.public.chapter ?? '',
      proof: steps.map((l) => l.statement),
      lines: steps.map((l) => ({
        n: l.idx,
        statement: l.statement,
        ...(l.justification ? { justification: l.justification } : {}),
      })),
      summary,
      weakPoints,
      reviewPublished: published,
      canRedo,
      completedAt: iso(attempt.completed_at ?? attempt.started_at),
    };
    if (definition !== undefined) card.definition = definition;
    if (published && attempt.review_note) card.teacherNote = attempt.review_note;
    if (attempt.independence !== null) card.independence = Number(attempt.independence);
    cards.push(card);

    if (attempt.kind === 'main' && canRedo && mistakes.length > 0 && !redone.has(attempt.id)) {
      toRedo.push({
        assignmentId: attempt.assignment_id,
        title: card.title,
        chapter: card.chapter,
        mode: attempt.asg_mode,
        status: attempt.asg_status,
        attemptId: attempt.id,
        attemptStatus: 'completed',
        problemId: attempt.problem_id,
        version: attempt.problem_version,
        reviewPublished: published,
      });
    }
  }
  return { cards, toRedo };
}

function conceptOf(attempt: AttemptInfo): string {
  const pub = attempt.public as { def?: { conceptId?: string } };
  return pub.def?.conceptId ?? '';
}

// 首页的证明本计数：与 /student/notebook、/student/mistakes 同一口径。
export async function notebookCounts(db: Queryable, userId: string): Promise<{ cards: number; toRedo: number }> {
  const { cards, toRedo } = await buildNotebook(db, userId);
  return { cards: cards.length, toRedo: toRedo.length };
}

// GET /attempts/{attemptId}/review：教师发布讲评后，本人完成了作答（或布置已结束）才返回参考证明与讲评。
// 读参考证明记审计（vault.reference_access_log，purpose=review）。
export async function loadReview(
  db: Db,
  contract: ContractValidator,
  userId: string,
  attemptId: string,
): Promise<Record<string, unknown>> {
  return db.tx(async (tx) => {
    const row = (
      await tx.query<{
        problem_id: string;
        problem_version: number;
        status: string;
        asg_closed: boolean;
        review_published_at: Date | null;
        review_note: string | null;
      }>(
        `select a.problem_id, a.problem_version, a.status,
                (asg.status in ('closed', 'cancelled') or (asg.close_at is not null and asg.close_at <= now())) as asg_closed,
                asg.review_published_at, asg.review_note
           from app.attempts a join app.assignments asg on asg.id = a.assignment_id
          where a.id = $1 and a.user_id = $2`,
        [attemptId, userId],
      )
    ).rows[0];
    if (!row) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    if (row.review_published_at === null) throw new AppError('FORBIDDEN', 403, '老师还没有发布讲评');
    if (row.status !== 'completed' && !row.asg_closed) throw new AppError('FORBIDDEN', 403, '写完这道题或布置结束后才能看讲评');

    const proofs = (
      await tx.query<{ text: string }>(
        `select text from vault.reference_proofs where problem_id = $1 and version = $2 and publishable order by proof_id`,
        [row.problem_id, row.problem_version],
      )
    ).rows.map((r) => r.text);
    await tx.query(
      `insert into vault.reference_access_log (user_id, problem_id, version, purpose) values ($1, $2, $3, 'review')`,
      [userId, row.problem_id, row.problem_version],
    );
    const dto: Record<string, unknown> = { proofs };
    if (row.review_note) dto.note = row.review_note;
    contract.validate('PublishedReview', dto);
    return dto;
  });
}
