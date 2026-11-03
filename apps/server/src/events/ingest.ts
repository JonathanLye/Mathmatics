import { hasValidConsent } from '../auth/consent.ts';
import type { Db, Queryable } from '../db/index.ts';
import { applyIntegrityRules } from '../integrity/effects.ts';

import { CLIENT_EVENT_TYPES, isValidClientEvent } from './client-schema.ts';

// 教师端产生的客户端类型（08 §3 的"产生方"为教师端）：学生不能上报，教师与管理员可以。
// 与事件目录的一致性由测试检查（test/events.test.ts）。
export const TEACHER_CLIENT_TYPES: ReadonlySet<string> = new Set(['t.view', 't.mirror']);

// 知情同意前允许的类型：打开应用、页面切换、前端错误。其余都是过程监测（13 §2、11 §8），需要同意。
export const PRE_CONSENT_TYPES: ReadonlySet<string> = new Set(['app.open', 'nav.page', 'sys.error']);

export type RejectReason =
  | 'malformed'
  | 'not_client_type'
  | 'wrong_role'
  | 'consent_required'
  | 'schema'
  | 'attempt_not_found';

export interface Rejected {
  id?: string;
  reason: RejectReason;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: Rejected[];
}

export interface Actor {
  userId: string;
  role: 'student' | 'teacher' | 'admin';
}

interface Candidate {
  id: string;
  raw: Record<string, unknown>;
  attemptId: string | null;
}

type AttemptContext = {
  id: string;
  user_id: string;
  assignment_id: string;
  mode: string;
  class_id: string;
  arm: string | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 按条处理：只有通过全部检查的事件才去重、入库；坏的一条不影响同批的其它条（响应里的 rejected）。
// 任何数据库错误都会回滚整批；客户端带同一批 id 重试是安全的（ev.ingest_ids 去重）。
export async function ingestBatch(db: Db, actor: Actor, events: readonly unknown[]): Promise<IngestResult> {
  const consented = actor.role !== 'student' || (await hasValidConsent(db, actor.userId));
  const rejected: Rejected[] = [];
  const candidates: Candidate[] = [];

  // 1. 不查数据库的检查：格式、类型、角色、同意书、结构。
  for (const raw of events) {
    if (!isObject(raw) || typeof raw.id !== 'string') {
      rejected.push({ reason: 'malformed' });
      continue;
    }
    const id = raw.id;
    if (typeof raw.type !== 'string' || !CLIENT_EVENT_TYPES.has(raw.type)) {
      rejected.push({ id, reason: 'not_client_type' });
      continue;
    }
    if (TEACHER_CLIENT_TYPES.has(raw.type) && actor.role === 'student') {
      rejected.push({ id, reason: 'wrong_role' });
      continue;
    }
    if (!consented && !PRE_CONSENT_TYPES.has(raw.type)) {
      rejected.push({ id, reason: 'consent_required' });
      continue;
    }
    if (!isValidClientEvent(raw)) {
      rejected.push({ id, reason: 'schema' });
      continue;
    }
    candidates.push({ id, raw, attemptId: typeof raw.attemptId === 'string' ? raw.attemptId : null });
  }

  return db.tx(async (tx) => {
    // 2. 作答归属：学生只能上报自己的作答；教师与管理员只检查作答存在（班级范围的检查属于教师端的后续工作）。
    const attempts = await loadAttempts(tx, candidates);
    const owned: Candidate[] = [];
    for (const c of candidates) {
      if (c.attemptId === null) {
        owned.push(c);
        continue;
      }
      const attempt = attempts.get(c.attemptId);
      if (!attempt || (actor.role === 'student' && attempt.user_id !== actor.userId)) {
        rejected.push({ id: c.id, reason: 'attempt_not_found' });
        continue;
      }
      owned.push(c);
    }

    // 3. 去重：在同一事务里先占用 ev.ingest_ids。重复的计数，不写入。
    let duplicates = 0;
    const fresh: Candidate[] = [];
    for (const c of owned) {
      const claimed = await tx.query<{ id: string }>(
        `insert into ev.ingest_ids (id) values ($1) on conflict do nothing returning id`,
        [c.id],
      );
      if (claimed.rows.length === 0) duplicates += 1;
      else fresh.push(c);
    }

    // 4. seq：带作答的事件，按作答一次性预留一段（同一作答只更新一次 last_event_seq）。
    //    不带作答的事件 seq 为 0：07 只规定"按用户另计"，没有对应的计数器，见 PR 说明。
    const perAttempt = new Map<string, number>();
    for (const c of fresh) {
      if (c.attemptId !== null) perAttempt.set(c.attemptId, (perAttempt.get(c.attemptId) ?? 0) + 1);
    }
    // 按 id 排序后逐个加锁：两个并发批次以同一顺序锁作答行，避免互相等待（死锁）。
    const nextSeq = new Map<string, number>();
    for (const attemptId of [...perAttempt.keys()].sort()) {
      const n = perAttempt.get(attemptId) ?? 0;
      const reserved = await tx.query<{ last_event_seq: number | string }>(
        `update app.attempts set last_event_seq = last_event_seq + $2 where id = $1 returning last_event_seq`,
        [attemptId, n],
      );
      nextSeq.set(attemptId, Number(reserved.rows[0]?.last_event_seq ?? 0) - n);
    }

    // 5. 信封补全并入库。
    const anon = (await tx.query<{ anon_code: string }>(`select anon_code from app.users where id = $1`, [actor.userId]))
      .rows[0]?.anon_code ?? 'unknown';
    for (const c of fresh) {
      const attempt = c.attemptId === null ? undefined : attempts.get(c.attemptId);
      let seq = 0;
      if (c.attemptId !== null) {
        const base = nextSeq.get(c.attemptId) ?? 0;
        seq = base + 1;
        nextSeq.set(c.attemptId, base + 1);
      }
      await insertEvent(tx, c, actor, anon, attempt, seq);
    }

    // 6. 诚信规则：粘贴、多设备、测验锁定。写服务端事件，与本批事件同一事务。
    await applyIntegrityRules(tx, {
      eventIds: fresh.map((c) => c.id),
      attemptIds: fresh.flatMap((c) => (c.attemptId === null ? [] : [c.attemptId])),
    });

    return { accepted: fresh.length, duplicates, rejected };
  });
}

async function loadAttempts(q: Queryable, candidates: readonly Candidate[]): Promise<Map<string, AttemptContext>> {
  const ids = [...new Set(candidates.flatMap((c) => (c.attemptId === null ? [] : [c.attemptId])))];
  const found = new Map<string, AttemptContext>();
  if (ids.length === 0) return found;
  const rows = await q.query<AttemptContext>(
    `select t.id, t.user_id, t.assignment_id, t.mode, asg.class_id, m.arm
       from app.attempts t
       join app.assignments asg on asg.id = t.assignment_id
       left join app.class_members m on m.class_id = asg.class_id and m.user_id = t.user_id
      where t.id = any($1::uuid[])`,
    [ids],
  );
  for (const row of rows.rows) found.set(row.id, row);
  return found;
}

async function insertEvent(
  tx: Queryable,
  c: Candidate,
  actor: Actor,
  anon: string,
  attempt: AttemptContext | undefined,
  seq: number,
): Promise<void> {
  const raw = c.raw;
  await tx.query(
    `insert into ev.events
       (id, seq, type, source, ts_server, ts_client, session_id, device_id, client_seq,
        user_id, user_anon, role, class_id, assignment_id, attempt_id, mode, arm, layer, payload)
     values ($1, $2, $3, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)`,
    [
      c.id,
      seq,
      raw.type,
      actor.role === 'student' ? 'student' : 'teacher',
      typeof raw.tsClient === 'string' ? raw.tsClient : null,
      raw.sessionId,
      raw.deviceId,
      raw.clientSeq,
      actor.userId,
      anon,
      actor.role,
      attempt?.class_id ?? null,
      attempt?.assignment_id ?? null,
      attempt?.id ?? null,
      attempt?.mode ?? null,
      attempt?.arm ?? null,
      typeof raw.layer === 'string' ? raw.layer : null,
      JSON.stringify(raw.payload),
    ],
  );
}
