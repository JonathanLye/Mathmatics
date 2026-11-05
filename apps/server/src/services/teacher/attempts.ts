import { nextKey } from '@proof-gym/engine';

import type { AuthContext } from '../../auth/session.ts';
import { decryptPii } from '../../auth/crypto.ts';
import type { AppConfig } from '../../config.ts';
import type { Db, Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { loadProblem } from '../../attempts/problem.ts';
import { computeAttemptMetrics } from '../../metrics/attempt.ts';
import { loadTeacherAttempt, type TeacherAttemptRow } from './auth.ts';

export interface StoredEventDto {
  id: string;
  seq: number;
  type: string;
  source: string;
  tsServer: string;
  tsClient?: string | null;
  classId?: string | null;
  assignmentId?: string | null;
  attemptId?: string | null;
  problemId?: string | null;
  problemVersion?: number | null;
  layer?: string | null;
  mode?: string | null;
  arm?: string | null;
  appVersion?: string | null;
  platform?: string | null;
  promptVersion?: string | null;
  modelVersions?: unknown;
  userAnon: string;
  role: string;
  payload: Record<string, unknown>;
}

type EventRow = {
  id: string;
  seq: string | number;
  type: string;
  source: string;
  ts_server: Date | string;
  ts_client: Date | string | null;
  class_id: string | null;
  assignment_id: string | null;
  attempt_id: string | null;
  problem_id: string | null;
  problem_version: number | null;
  layer: string | null;
  mode: string | null;
  arm: string | null;
  app_version: string | null;
  platform: string | null;
  prompt_version: string | null;
  model_versions: unknown;
  user_anon: string;
  role: string;
  payload: Record<string, unknown>;
};

function toStoredEvent(row: EventRow): StoredEventDto {
  return {
    id: row.id,
    seq: Number(row.seq),
    type: row.type,
    source: row.source,
    tsServer: new Date(row.ts_server).toISOString(),
    tsClient: row.ts_client === null ? null : new Date(row.ts_client).toISOString(),
    classId: row.class_id,
    assignmentId: row.assignment_id,
    attemptId: row.attempt_id,
    problemId: row.problem_id,
    problemVersion: row.problem_version,
    layer: row.layer,
    mode: row.mode,
    arm: row.arm,
    appVersion: row.app_version,
    platform: row.platform,
    promptVersion: row.prompt_version,
    modelVersions: row.model_versions,
    userAnon: row.user_anon,
    role: row.role,
    payload: row.payload,
  };
}

export async function loadAttemptEvents(
  db: Queryable,
  auth: AuthContext,
  attemptId: string,
  afterSeq: number,
  limit: number,
): Promise<{ events: StoredEventDto[]; nextSeq: number | null }> {
  await loadTeacherAttempt(db, auth, attemptId);
  const rows = (
    await db.query<EventRow>(
      `select id, seq, type, source, ts_server, ts_client, class_id, assignment_id, attempt_id,
              problem_id, problem_version, layer, mode, arm, app_version, platform, prompt_version,
              model_versions, user_anon, role, payload
         from ev.events where attempt_id = $1 and seq > $2 order by seq limit $3`,
      [attemptId, afterSeq, limit],
    )
  ).rows;
  const events = rows.map(toStoredEvent);
  const last = events.at(-1);
  const nextSeq = events.length === limit && last !== undefined ? last.seq : null;
  return { events, nextSeq };
}

type LineRow = {
  id: string;
  layer: string;
  idx: number;
  statement: string;
  justification: string | null;
  provenance: string;
  cls: string | null;
  keys: string[];
  conf: number | null;
  classifier_path: string | null;
}

type HintEventRow = {
  ts_server: Date | string;
  payload: Record<string, unknown>;
}

type IntegrityRow = {
  id: string;
  signal: string;
  score: number;
  evidence: unknown;
  source: string;
  disposition: string | null;
  created_at: Date | string;
}

export async function loadAttemptDetail(
  db: Queryable,
  config: AppConfig,
  auth: AuthContext,
  attemptId: string,
): Promise<Record<string, unknown>> {
  const row: TeacherAttemptRow = await loadTeacherAttempt(db, auth, attemptId);
  const problem = await loadProblem(db, row.problem_id, row.problem_version);
  const secret = problem.ctx.pkg.secret;

  const anon = (
    await db.query<{ anon_code: string }>(`select anon_code from app.users where id = $1`, [row.user_id])
  ).rows[0]?.anon_code;
  if (!anon) throw new AppError('INTERNAL', 500, '作答用户缺失');

  const roster = (
    await db.query<{ name_enc: Buffer | null }>(
      `select name_enc from app.roster_entries where class_id = $1 and claimed_by = $2 limit 1`,
      [row.class_id, row.user_id],
    )
  ).rows[0];
  let displayName: string | null = null;
  if (roster?.name_enc) {
    try {
      displayName = decryptPii(config.piiKey, Buffer.from(roster.name_enc));
    } catch {
      displayName = null;
    }
  }

  const lines = (
    await db.query<LineRow>(
      `select id, layer, idx, statement, justification, provenance, cls, keys, conf, classifier_path
         from app.attempt_lines
        where attempt_id = $1 and deleted_at is null
        order by layer, idx`,
      [attemptId],
    )
  ).rows.map((line) => ({
    lineId: line.id,
    layer: line.layer,
    n: line.idx,
    statement: line.statement,
    justification: line.justification ?? '',
    provenance: line.provenance,
    cls: line.cls ?? '',
    keys: line.keys,
    conf: line.conf,
    path: line.classifier_path ?? '',
    recognition: null,
    inkId: null,
  }));

  // 提示文本从题目包预写内容还原；hint_deliveries 表目前没有写入（B 的后续工作），先用事件 + secret。
  const hintEvents = (
    await db.query<HintEventRow>(
      `select ts_server, payload from ev.events
        where attempt_id = $1 and type = 'hint.deliver' order by seq`,
      [attemptId],
    )
  ).rows;
  const hints = hintEvents.map((event) => {
    const keyId = String(event.payload.key ?? '');
    const level = String(event.payload.level ?? '');
    const key = secret.keys.find((item) => item.id === keyId);
    const index = Number(level.slice(1));
    const text = key?.hints[Number.isFinite(index) ? index : 0]?.text ?? '';
    return {
      hintId: String(event.payload.hintId ?? ''),
      key: keyId,
      level,
      cost: Number(event.payload.cost ?? 0),
      revealAfter: Number(event.payload.revealAfter ?? 0),
      override: event.payload.override ?? false,
      text,
      deliveredAt: new Date(event.ts_server).toISOString(),
    };
  });

  const integrity = (
    await db.query<IntegrityRow>(
      `select id, signal, score, evidence, source, disposition, created_at
         from app.integrity_signals where attempt_id = $1 order by created_at`,
      [attemptId],
    )
  ).rows.map((signal) => ({
    flagId: signal.id,
    signal: signal.signal,
    score: Number(signal.score),
    evidence: signal.evidence,
    source: signal.source,
    disposition: signal.disposition,
    at: new Date(signal.created_at).toISOString(),
  }));

  const timeline = (
    await db.query<{ seq: string | number; type: string; ts_server: Date | string; layer: string | null }>(
      `select seq, type, ts_server, layer from ev.events where attempt_id = $1 order by seq limit 500`,
      [attemptId],
    )
  ).rows.map((event) => ({
    seq: Number(event.seq),
    type: event.type,
    at: new Date(event.ts_server).toISOString(),
    layer: event.layer,
  }));

  const helpFlags = (
    await db.query<{ id: string; layer: string | null; created_at: Date | string; resolved_at: Date | string | null; note: string | null }>(
      `select id, layer, created_at, resolved_at, note from app.help_flags where attempt_id = $1 order by created_at`,
      [attemptId],
    )
  ).rows.map((flag) => ({
    flagId: flag.id,
    kind: 'help',
    layer: flag.layer,
    at: new Date(flag.created_at).toISOString(),
    resolved: flag.resolved_at !== null,
    note: flag.note,
  }));

  const metrics = await computeAttemptMetrics(db, attemptId);

  return {
    attemptId: row.id,
    anonCode: anon,
    displayName,
    status: row.status,
    mode: row.mode,
    problem: {
      problemId: row.problem_id,
      version: row.problem_version,
      title: problem.public.title ?? row.problem_id,
    },
    lines,
    hints,
    // 06 §2 的白名单：notes 目前恒为空（B 的 attempts/view.ts 也投影 []；annotation/hint 持久化未实现）。
    notes: [],
    // 契约没有给 help flag 的命名 schema（#51 缺口，见 PR）；先以额外字段暴露 flagId 供 #35 处理标记。
    helpFlags,
    integrity,
    timeline,
    metrics,
  };
}


export interface ReclassifyInput {
  cls: 'match' | 'error' | 'unknown' | 'lowconf' | 'demo_needs_reason' | 'pass' | 'fail';
  keys?: string[];
  errorId?: string | null;
  note?: string;
}

// 04 §4：低置信/错误归类的教师改判。只改 teacher 侧归类（classifier_path='teacher'）并写 audit_log，
// 不写事件/注解，学生已看到的内容不变。
export async function reclassifyLine(
  db: Db,
  auth: AuthContext,
  attemptId: string,
  lineId: string,
  input: ReclassifyInput,
): Promise<Record<string, unknown>> {
  await loadTeacherAttempt(db, auth, attemptId);
  return db.tx(async (tx) => {
    const before = (
      await tx.query<{ cls: string | null; keys: string[]; error_id: string | null }>(
        `select cls, keys, error_id from app.attempt_lines
          where id = $1 and attempt_id = $2 and deleted_at is null
          for update`,
        [lineId, attemptId],
      )
    ).rows[0];
    if (before === undefined) throw new AppError('NOT_FOUND', 404, '证明行不存在');
    const after = (
      await tx.query<{ cls: string; keys: string[]; error_id: string | null; classifier_path: string }>(
        `update app.attempt_lines
            set cls = $3, keys = coalesce($4::text[], keys), error_id = $5, classifier_path = 'teacher'
          where id = $1 and attempt_id = $2
          returning cls, keys, error_id, classifier_path`,
        [lineId, attemptId, input.cls, input.keys ?? null, input.errorId ?? null],
      )
    ).rows[0]!;
    await tx.query(
      `insert into app.audit_log (actor_id, action, target, detail)
       values ($1, 'reclassify_line', $2, $3::jsonb)`,
      [
        auth.userId,
        `${attemptId}:${lineId}`,
        JSON.stringify({
          attemptId,
          lineId,
          before: { cls: before.cls, keys: before.keys, errorId: before.error_id },
          after: { cls: after.cls, keys: after.keys, errorId: after.error_id },
          note: input.note ?? null,
        }),
      ],
    );
    return { lineId, cls: after.cls, keys: after.keys, errorId: after.error_id, classifierPath: after.classifier_path };
  });
}
