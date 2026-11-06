import type { Queryable } from '../db/index.ts';

// 求助落库：已下发的提示（app.hint_deliveries）和批注（app.annotations）。
// 提示行与状态变化在同一事务里写入；行 ID 就是 Note 的 noteId，刷新后重新读出来时前端按 noteId 去重。
// 这里的文本都是已经过闸门、已经发给学生的文本（text_shown），不是 secret。

export interface HintDeliveryInput {
  id: string;
  attemptId: string;
  helpId: string | null;
  key: string;
  level: string;
  cost: number;
  revealBefore: number;
  revealAfter: number;
  text: string;
}

export async function insertHintDelivery(q: Queryable, input: HintDeliveryInput): Promise<void> {
  await q.query(
    `insert into app.hint_deliveries (id, attempt_id, help_id, key_id, level, cost, reveal_before, reveal_after, text_shown)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [input.id, input.attemptId, input.helpId, input.key, input.level, input.cost, input.revealBefore, input.revealAfter, input.text],
  );
}

export interface AnnotationInput {
  id: string;
  attemptId: string;
  lineId: string | null;
  kind: 'annotation' | 'concept';
  source: 'rule' | 'llm';
  text: string;
  helpId?: string | null;
  aiGenerated?: boolean;
}

export async function insertAnnotation(q: Queryable, input: AnnotationInput): Promise<void> {
  await q.query(
    `insert into app.annotations (id, attempt_id, line_id, kind, source, text_shown, help_id, ai_generated)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.id, input.attemptId, input.lineId, input.kind, input.source, input.text, input.helpId ?? null, input.aiGenerated ?? false],
  );
}

const MAX_ANNOTATIONS = 20;

type DeliveryRow = { id: string; key_id: string; level: string; cost: string | number; text_shown: string; created_at: Date | string };
type AnnotationRow = {
  id: string;
  line_id: string | null;
  kind: string;
  text_shown: string;
  ai_generated: boolean;
  created_at: Date | string;
};

// 读回这次作答已下发的提示与批注（按时间排序）。批注只取最近 20 条，防止响应无限增长。
export async function loadStoredNotes(q: Queryable, attemptId: string, conceptId: string | null): Promise<Record<string, unknown>[]> {
  const deliveries = (
    await q.query<DeliveryRow>(
      `select id, key_id, level, cost, text_shown, created_at from app.hint_deliveries where attempt_id = $1 order by created_at, id`,
      [attemptId],
    )
  ).rows;
  const annotations = (
    await q.query<AnnotationRow>(
      `select id, line_id, kind, text_shown, ai_generated, created_at from (
         select id, line_id, kind, text_shown, ai_generated, created_at from app.annotations
          where attempt_id = $1 order by created_at desc, id desc limit ${MAX_ANNOTATIONS}
       ) recent order by created_at, id`,
      [attemptId],
    )
  ).rows;
  const iso = (value: Date | string): string => new Date(value).toISOString();
  const hints = deliveries.map((row) => ({
    noteId: row.id,
    kind: 'hint',
    who: `${row.level} · 透露 ${Number(row.cost)}`,
    text: row.text_shown,
    lineId: null,
    level: row.level,
    cost: Number(row.cost),
    lessonConceptId: null,
    at: iso(row.created_at),
  }));
  const margin = annotations.map((row) => ({
    noteId: row.id,
    kind: row.kind,
    who: row.kind === 'concept' ? '助教' : '批注',
    text: row.text_shown,
    lineId: row.line_id,
    level: row.kind === 'concept' ? 'H0' : null,
    cost: null,
    lessonConceptId: row.kind === 'concept' ? conceptId : null,
    at: iso(row.created_at),
    ...(row.ai_generated ? { aiGenerated: true } : {}),
  }));
  return [...hints, ...margin].sort((a, b) => a.at.localeCompare(b.at));
}

// 同一条非模型批注（同一行、同样文字）只存一次：重复点“概念”或“检查这一行”不会把右栏刷满，也不会产生新的 noteId。
export async function upsertAnnotation(q: Queryable, input: AnnotationInput): Promise<{ id: string; at: string }> {
  if (input.aiGenerated !== true) {
    const found = await q.query<{ id: string; created_at: Date | string }>(
      `select id, created_at from app.annotations
        where attempt_id = $1 and kind = $2 and text_shown = $3 and ai_generated = false and line_id is not distinct from $4
        order by created_at limit 1`,
      [input.attemptId, input.kind, input.text, input.lineId],
    );
    const row = found.rows[0];
    if (row) return { id: row.id, at: new Date(row.created_at).toISOString() };
  }
  await insertAnnotation(q, input);
  const saved = await q.query<{ created_at: Date | string }>(`select created_at from app.annotations where id = $1`, [input.id]);
  return { id: input.id, at: new Date(saved.rows[0]?.created_at ?? Date.now()).toISOString() };
}
