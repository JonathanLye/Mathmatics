import { createHmac, timingSafeEqual } from 'node:crypto';

import { deserializeState } from '@proof-gym/engine';

import type { Db, Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';
import { nextSeq } from '../../integrity/seq.ts';
import { loadProblem } from '../../attempts/problem.ts';
import { toAttemptState, type AttemptRow } from '../../attempts/view.ts';
import { appendTeacherAttemptEvent } from './events.ts';

// 04 §5.1 / 06 §6：5 分钟只读镜像令牌；iframe 用 ?token= 调 SSE，不需要教师 Cookie。
const TOKEN_TTL_MS = 5 * 60_000;
const VERSION = 1;

export interface MirrorToken {
  token: string;
  url: string;
  expiresAt: string;
}

export interface MirrorPayload {
  v: number;
  a: string;
  u: string;
  exp: number;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`mirror.${payload}`).digest('base64url');
}

export function issueMirrorToken(attemptId: string, teacherId: string, secret: string): MirrorToken {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload: MirrorPayload = { v: VERSION, a: attemptId, u: teacherId, exp };
  const encoded = base64url(JSON.stringify(payload));
  const token = `${encoded}.${signature(encoded, secret)}`;
  return {
    token,
    url: `/s/mirror?attempt=${encodeURIComponent(attemptId)}&token=${encodeURIComponent(token)}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

// 校验签名（constant-time）+ 过期 + 绑定 attemptId；失败一律 null，由路由转 401。
export function verifyMirrorToken(token: string, attemptId: string, secret: string): MirrorPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts as [string, string];
  const expected = signature(encoded, secret);
  const given = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let payload: MirrorPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MirrorPayload;
  } catch {
    return null;
  }
  if (payload.v !== VERSION || payload.a !== attemptId || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Date.now()) return null;
  return payload;
}

export type AttemptMeta = {
  id: string;
  class_id: string;
  assignment_id: string;
  problem_id: string;
  problem_version: number;
  mode: 'practice' | 'test';
  current_layer: string;
  status: string;
  state_version: number;
};

export async function loadAttemptMeta(db: Queryable, attemptId: string): Promise<AttemptMeta> {
  const row = (
    await db.query<AttemptMeta>(
      `select a.id, asg.class_id, a.assignment_id, a.problem_id, a.problem_version, a.mode,
              a.current_layer, a.status, a.state_version
         from app.attempts a join app.assignments asg on asg.id = a.assignment_id
        where a.id = $1`,
      [attemptId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '作答不存在');
  return row;
}

// 镜像里看到的就是学生端 DTO（05 §4 / 04 §5.1），复用 attempts/view 的 toAttemptState，不另写白名单。
export async function loadMirrorState(db: Queryable, attemptId: string): Promise<Record<string, unknown>> {
  const row = (
    await db.query<AttemptRow & { state: unknown }>(
      `select id, assignment_id, user_id, problem_id, problem_version, kind, parent_attempt_id, mode,
              status, state, state_version, keys_total, last_event_seq
         from app.attempts where id = $1`,
      [attemptId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '作答不存在');
  const state = deserializeState(row.state as AttemptRow['state']);
  const problem = await loadProblem(db, row.problem_id, row.problem_version);
  return toAttemptState({ row, state, problem, now: Date.now() });
}

// 打开/关闭镜像写 t.mirror（04 §5.1）；由服务端在 SSE 连接建立/断开时记录，避免依赖学生页上报。
export async function appendMirrorEvent(
  db: Db,
  meta: AttemptMeta,
  teacherId: string,
  action: 'open' | 'close',
): Promise<void> {
  await db.tx(async (tx) => {
    await tx.query(`select id from app.attempts where id = $1 for update`, [meta.id]);
    const seq = await nextSeq(tx, meta.id);
    await appendTeacherAttemptEvent(tx, {
      type: 't.mirror',
      seq,
      teacherId,
      classId: meta.class_id,
      attemptId: meta.id,
      assignmentId: meta.assignment_id,
      problemId: meta.problem_id,
      problemVersion: meta.problem_version,
      layer: meta.current_layer,
      mode: meta.mode,
      payload: { action },
    });
  });
}
