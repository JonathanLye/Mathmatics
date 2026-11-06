import { randomUUID } from 'node:crypto';

import { gateRule, type Secret } from '@proof-gym/engine';
import type { FastifyInstance } from 'fastify';

import { studentNoHash } from '../../src/auth/crypto.ts';
import type { Db } from '../../src/db/index.ts';
import { seedContent } from '../../src/db/seed.ts';

import {
  buildTestApp,
  cookieFrom,
  loginBody,
  setStudentAgeBand,
  setupFixture,
  testConfig,
  WRITE_HEADERS,
  type Fixture,
} from './fixtures.ts';

// 证明本 / 错题本 / 重做 / 进度 / 设置 的测试共用：一个种子库 + 一个班 + 一位教师，并能快速造出「已完成的作答」。
export const ALL_REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
export const DRAFT_ID = '00000000-0000-4000-8000-0000000000d1';
export const input = { provenance: 'keyboard', draftId: DRAFT_ID };

export interface Env {
  fx: Fixture;
  db: Db;
  app: FastifyInstance;
  teacherId: string;
  seen: { body: string }[];
  close(): Promise<void>;
}

export async function makeEnv(): Promise<Env> {
  const fx = await setupFixture();
  await seedContent(fx.db);
  const app = await buildTestApp(fx.db);
  const teacherId = (await fx.db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
  return {
    fx,
    db: fx.db,
    app,
    teacherId,
    seen: [],
    close: async () => {
      await app.close();
      await fx.close();
    },
  };
}

export async function login(env: Env, body = loginBody(), consent: Partial<typeof ALL_REQUIRED> = {}): Promise<string> {
  const res = await env.app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: body });
  const cookie = cookieFrom(res.headers['set-cookie']);
  await setStudentAgeBand(env.app, cookie);
  const signed = await env.app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'p0-v1', items: { ...ALL_REQUIRED, ...consent } },
  });
  if (signed.statusCode !== 200) throw new Error(`consent ${signed.statusCode} ${signed.body}`);
  return cookie;
}

// 班里再加一位学生并登录。
export async function addStudent(env: Env, studentNo: string): Promise<string> {
  await env.db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)`, [
    env.fx.classId,
    studentNoHash(testConfig.studentNoPepper, studentNo),
  ]);
  return login(env, loginBody({ studentNo, deviceId: randomUUID() }));
}

export async function openAssignment(
  env: Env,
  problemId = 'epsN',
  opts: { mode?: 'practice' | 'test'; status?: string; closeAt?: string | null } = {},
): Promise<string> {
  const version = (
    await env.db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = $1`, [problemId])
  ).rows[0]?.version;
  const row = await env.db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, close_at, status, created_by)
     values ($1, $2, $3, $4, now() - interval '1 hour', $5, $6, $7) returning id`,
    [env.fx.classId, problemId, version, opts.mode ?? 'practice', opts.closeAt ?? null, opts.status ?? 'open', env.teacherId],
  );
  return row.rows[0]?.id as string;
}

export async function post(env: Env, cookie: string, path: string, payload?: object, headers: Record<string, string> = {}) {
  const res = await env.app.inject({ method: 'POST', url: `/api/v1${path}`, headers: { cookie, ...WRITE_HEADERS, ...headers }, payload });
  env.seen.push(res);
  return res;
}

export async function patch(env: Env, cookie: string, path: string, payload?: object) {
  const res = await env.app.inject({ method: 'PATCH', url: `/api/v1${path}`, headers: { cookie, ...WRITE_HEADERS }, payload });
  env.seen.push(res);
  return res;
}

export async function get(env: Env, cookie: string, path: string) {
  const res = await env.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { cookie } });
  env.seen.push(res);
  return res;
}

export async function startAttempt(env: Env, cookie: string, assignmentId: string): Promise<string> {
  const res = await post(env, cookie, `/student/assignments/${assignmentId}/attempt`);
  if (res.statusCode !== 200) throw new Error(`start ${res.statusCode} ${res.body}`);
  return res.json().state.attemptId as string;
}

export interface LineSpec {
  layer?: string;
  role?: string;
  idx?: number;
  slot?: string | null;
  statement: string;
  justification?: string | null;
  cls?: string | null;
  newKeys?: string[];
  errorId?: string | null;
}

export async function insertLine(env: Env, attemptId: string, line: LineSpec): Promise<void> {
  await env.db.query(
    `insert into app.attempt_lines
       (id, attempt_id, layer, role, idx, slot, statement, justification, statement_canon, provenance, cls, keys, new_keys, error_id)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $6, 'keyboard', $8, $9::text[], $9::text[], $10)`,
    [
      attemptId,
      line.layer ?? 'L3',
      line.role ?? 'step',
      line.idx ?? 1,
      line.slot ?? null,
      line.statement,
      line.justification ?? null,
      line.cls ?? null,
      line.newKeys ?? [],
      line.errorId ?? null,
    ],
  );
}

// 白盒：把作答改成「已完成」。patch 改引擎状态（如 keyCost、def）。
export async function forceComplete(
  env: Env,
  attemptId: string,
  patchState: (state: Record<string, any>) => Record<string, any> = (s) => s,
  extra: { independence?: number; completedAt?: string } = {},
): Promise<void> {
  const stored = (await env.db.query<{ state: Record<string, any> }>(`select state from app.attempts where id = $1`, [attemptId])).rows[0]
    ?.state as Record<string, any>;
  const state = patchState({ ...stored, done: true, layer: 6 });
  await env.db.query(
    `update app.attempts set state = $2::jsonb, current_layer = 'L6', status = 'completed',
            independence = $3, completed_at = coalesce($4::timestamptz, now()) where id = $1`,
    [attemptId, JSON.stringify(state), extra.independence ?? 1, extra.completedAt ?? null],
  );
}

// 对所有记录下来的响应做泄露扫描（与 attempts.test.ts 同一判据：matched 取空集，最严格）。
export async function leaks(env: Env): Promise<string[]> {
  const secrets = (await env.db.query<{ secret: Secret }>(`select secret from vault.problem_secrets`)).rows.map((r) => r.secret);
  const hits: string[] = [];
  const walk = (value: unknown, out: string[]): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => walk(v, out));
  };
  for (const { body } of env.seen) {
    const strings: string[] = [];
    walk(JSON.parse(body), strings);
    for (const text of strings) {
      for (const secret of secrets) {
        const r = gateRule(secret, text, new Set(), []);
        if (!r.ok) for (const h of r.hits) hits.push(`${h.key}: ${h.frag}`);
      }
    }
  }
  return hits;
}
