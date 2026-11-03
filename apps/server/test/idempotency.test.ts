import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { studentNoHash } from '../src/auth/crypto.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
import {
  cleanupExpiredIdempotencyKeys,
  KEY_TTL_HOURS,
  REPLAY_HEADER,
  requestHash,
  STALE_CLAIM_SECONDS,
} from '../src/idempotency.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, testConfig, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const CONSENT = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';
const DRAFT = '00000000-0000-4000-8000-0000000000d1';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let assignmentId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  const teacher = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id;
  const version = (await db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = 'epsN'`)).rows[0]?.version;
  assignmentId = (
    await db.query<{ id: string }>(
      `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
       values ($1, 'epsN', $2, 'practice', now() - interval '1 hour', 'open', $3) returning id`,
      [fx.classId, version, teacher],
    )
  ).rows[0]?.id as string;
});
afterEach(async () => {
  await app.close();
  await fx.close();
});

const post = (cookie: string, url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie, ...WRITE_HEADERS, ...headers }, payload });

async function student(studentNo = '2026001'): Promise<{ cookie: string; attemptId: string }> {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ studentNo }),
  });
  const cookie = cookieFrom(login.headers['set-cookie']);
  await post(cookie, '/consents', { version: 'p0-v1', items: CONSENT });
  const start = await post(cookie, `/student/assignments/${assignmentId}/attempt`);
  return { cookie, attemptId: start.json().state.attemptId as string };
}

// 跳过 L1、L2，到第 3 层才能写行。
async function atLayer3(studentNo?: string) {
  const s = await student(studentNo);
  for (const layer of ['L1', 'L2']) await post(s.cookie, `/attempts/${s.attemptId}/layers/${layer}/skip`);
  return s;
}

const line = { statement: '任取 $\\varepsilon>0$，取 $N=\\lceil 5/\\varepsilon\\rceil$', justification: '由题设', input: { provenance: 'keyboard', draftId: DRAFT } };
const stepCount = async (attemptId: string) =>
  Number((await db.query<{ n: string }>(`select count(*)::text n from app.attempt_lines where attempt_id = $1 and role = 'step'`, [attemptId])).rows[0]?.n);
const eventCount = async (attemptId: string) =>
  Number((await db.query<{ n: string }>(`select count(*)::text n from ev.events where attempt_id = $1`, [attemptId])).rows[0]?.n);

describe('Idempotency-Key（06 §1）', () => {
  it('同键重放：返回首次响应，不重复入库、不重复写事件', async () => {
    const { cookie, attemptId } = await atLayer3();
    const first = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    const events = await eventCount(attemptId);
    const again = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });

    expect(first.statusCode).toBe(200);
    expect(first.headers[REPLAY_HEADER]).toBeUndefined();
    expect(again.statusCode).toBe(200);
    expect(again.headers[REPLAY_HEADER]).toBe('true');
    expect(again.body).toBe(first.body);
    expect(await stepCount(attemptId)).toBe(1);
    expect(await eventCount(attemptId)).toBe(events);
  });

  it('不带 Idempotency-Key：行为不变（向后兼容）', async () => {
    const { cookie, attemptId } = await atLayer3();
    await post(cookie, `/attempts/${attemptId}/lines`, line);
    await post(cookie, `/attempts/${attemptId}/lines`, line);
    expect(await stepCount(attemptId)).toBe(2);
  });

  it('同键不同请求体：422，且不执行', async () => {
    const { cookie, attemptId } = await atLayer3();
    await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    const other = await post(cookie, `/attempts/${attemptId}/lines`, { ...line, statement: '另一行 $x>0$' }, { 'idempotency-key': KEY_A });

    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('VALIDATION_FAILED');
    expect(other.json().error.detail.reason).toBe('idempotency_key_reused');
    expect(await stepCount(attemptId)).toBe(1);
  });

  it('Idempotency-Key 不是 uuid：422', async () => {
    const { cookie, attemptId } = await atLayer3();
    const res = await post(cookie, `/attempts/${attemptId}/park`, undefined, { 'idempotency-key': 'not-a-uuid' });
    expect(res.statusCode).toBe(422);
  });

  it('不同用户用同一个键互不影响', async () => {
    await db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1, $2)`, [fx.classId, studentNoHash(testConfig.studentNoPepper, '2026002')]);
    const a = await student('2026001');
    const b = await student('2026002');
    const ra = await post(a.cookie, `/attempts/${a.attemptId}/layers/L1/skip`, undefined, { 'idempotency-key': KEY_A });
    const rb = await post(b.cookie, `/attempts/${b.attemptId}/layers/L1/skip`, undefined, { 'idempotency-key': KEY_A });
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    expect(rb.headers[REPLAY_HEADER]).toBeUndefined();
    expect(rb.json().state.attemptId).toBe(b.attemptId);
  });

  it('失败的请求不被缓存：释放占位，状态改变后同键可以正常执行', async () => {
    const { cookie, attemptId } = await student();
    const wrongLayer = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    expect(wrongLayer.statusCode).toBe(409);
    expect((await db.query(`select 1 from app.idempotency_keys`)).rows).toHaveLength(0);

    for (const layer of ['L1', 'L2']) await post(cookie, `/attempts/${attemptId}/layers/${layer}/skip`);
    const ok = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers[REPLAY_HEADER]).toBeUndefined();
    expect(await stepCount(attemptId)).toBe(1);
  });

  it('同键并发：只执行一次，两个请求都得到同一个成功响应', async () => {
    const { cookie, attemptId } = await atLayer3();
    const [r1, r2] = await Promise.all([
      post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A }),
      post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    expect(r1.body).toBe(r2.body);
    expect(await stepCount(attemptId)).toBe(1);
  });

  it('超过 24 小时的键过期：同键视为新请求', async () => {
    const { cookie, attemptId } = await atLayer3();
    await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    await db.query(`update app.idempotency_keys set created_at = now() - make_interval(hours => $1)`, [KEY_TTL_HOURS + 1]);
    const again = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    expect(again.statusCode).toBe(200);
    expect(again.headers[REPLAY_HEADER]).toBeUndefined();
    expect(await stepCount(attemptId)).toBe(2);
  });

  it('处理中的占位超过 STALE_CLAIM_SECONDS 视为遗弃，同一个请求可以接管', async () => {
    const { cookie, attemptId } = await atLayer3();
    const userId = (await db.query<{ id: string }>(`select id from app.users where role = 'student'`)).rows[0]?.id;
    const hash = requestHash({ method: 'POST', url: `/api/v1/attempts/${attemptId}/lines`, body: line } as FastifyRequest);
    await db.query(
      `insert into app.idempotency_keys (user_id, key, request_hash, created_at) values ($1, $2, $3, now() - make_interval(secs => $4))`,
      [userId, KEY_B, hash, STALE_CLAIM_SECONDS + 5],
    );
    const res = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_B });
    expect(res.statusCode).toBe(200);
    expect(await stepCount(attemptId)).toBe(1);
  });

  it('遗弃占位但请求体不同：422，不接管、不执行', async () => {
    const { cookie, attemptId } = await atLayer3();
    const userId = (await db.query<{ id: string }>(`select id from app.users where role = 'student'`)).rows[0]?.id;
    await db.query(
      `insert into app.idempotency_keys (user_id, key, request_hash, created_at) values ($1, $2, 'x', now() - make_interval(secs => $3))`,
      [userId, KEY_B, STALE_CLAIM_SECONDS + 5],
    );
    const res = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_B });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.detail.reason).toBe('idempotency_key_reused');
    expect(await stepCount(attemptId)).toBe(0);
  });

  it('请求体键序不同但逻辑相同：视为同一个请求，重放而不是 422', async () => {
    const { cookie, attemptId } = await atLayer3();
    const reordered = { input: line.input, justification: line.justification, statement: line.statement };
    const first = await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    const again = await post(cookie, `/attempts/${attemptId}/lines`, reordered, { 'idempotency-key': KEY_A });
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers[REPLAY_HEADER]).toBe('true');
    expect(await stepCount(attemptId)).toBe(1);
  });

  it('上一次仍在处理：等待上限后 429（detail.waitSec）', async () => {
    const { cookie, attemptId } = await student();
    const userId = (await db.query<{ id: string }>(`select id from app.users where role = 'student'`)).rows[0]?.id;
    const hash = requestHash({ method: 'POST', url: `/api/v1/attempts/${attemptId}/park`, body: undefined } as FastifyRequest);
    await db.query(
      `insert into app.idempotency_keys (user_id, key, request_hash) values ($1, $2, $3)`,
      [userId, KEY_B, hash],
    );
    const res = await post(cookie, `/attempts/${attemptId}/park`, undefined, { 'idempotency-key': KEY_B });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.detail.waitSec).toBe(1);
  });

  it('重复 Idempotency-Key 头（Fastify 合并成字符串）不是合法 uuid：422', async () => {
    const { cookie, attemptId } = await atLayer3();
    const res = await post(cookie, `/attempts/${attemptId}/park`, undefined, {
      'idempotency-key': `${KEY_A}, ${KEY_B}`,
    });
    expect(res.statusCode).toBe(422);
  });

  it('start 带键：重放返回首次响应，不重复创建作答；重放快照不是最新 state', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/student/login',
      headers: WRITE_HEADERS,
      payload: loginBody({ studentNo: '2026001' }),
    });
    const cookie = cookieFrom(login.headers['set-cookie']);
    await post(cookie, '/consents', { version: 'p0-v1', items: CONSENT });
    const first = await post(cookie, `/student/assignments/${assignmentId}/attempt`, undefined, { 'idempotency-key': KEY_A });
    const attemptId = first.json().state.attemptId as string;
    await post(cookie, `/attempts/${attemptId}/layers/L1/skip`);

    const again = await post(cookie, `/student/assignments/${assignmentId}/attempt`, undefined, { 'idempotency-key': KEY_A });
    expect(again.statusCode).toBe(200);
    expect(again.headers[REPLAY_HEADER]).toBe('true');
    expect(again.body).toBe(first.body);
    expect(again.json().state.attemptId).toBe(attemptId);
    // 重放的是首次响应快照；skip 已把库里的 stateVersion 推高，客户端不能拿它覆盖本地 state。
    const current = (
      await db.query<{ state_version: number }>(`select state_version from app.attempts where id = $1`, [attemptId])
    ).rows[0]?.state_version;
    expect(Number(current)).toBeGreaterThan(again.json().state.stateVersion as number);
    const count = (await db.query<{ n: string }>(`select count(*)::text n from app.attempts where user_id = (select id from app.users where role = 'student' limit 1)`)).rows[0]?.n;
    expect(count).toBe('1');
  });

  it('定时清理：只删超过 24h 的键', async () => {
    const { cookie, attemptId } = await atLayer3();
    await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    await db.query(`insert into app.idempotency_keys (user_id, key, request_hash, created_at) values ((select id from app.users where role = 'student' limit 1), $1, 'old', now() - interval '25 hours')`, [KEY_B]);
    const removed = await cleanupExpiredIdempotencyKeys(db);
    expect(removed).toBe(1);
    expect((await db.query(`select 1 from app.idempotency_keys`)).rows).toHaveLength(1);
  });

  it('/help 带同一键重放：只写 1 条 help.request 与 1 行 help_requests（#82+#84 联调）', async () => {
    const { cookie, attemptId } = await atLayer3();
    const first = await post(cookie, `/attempts/${attemptId}/help`, { intent: 'concept' }, { 'idempotency-key': KEY_A });
    const again = await post(cookie, `/attempts/${attemptId}/help`, { intent: 'concept' }, { 'idempotency-key': KEY_A });

    expect(first.statusCode, first.body).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers[REPLAY_HEADER]).toBe('true');
    const events = (
      await db.query<{ n: string }>(`select count(*)::text n from ev.events where attempt_id = $1 and type = 'help.request'`, [attemptId])
    ).rows[0]?.n;
    const rows = (await db.query<{ n: string }>(`select count(*)::text n from app.help_requests where attempt_id = $1`, [attemptId])).rows[0]?.n;
    expect(events).toBe('1');
    expect(rows).toBe('1');
  });

  it('复审 R4：同一 POST /lines 带同一键发两次，库里只有一行', async () => {
    const { cookie, attemptId } = await atLayer3();
    await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    await post(cookie, `/attempts/${attemptId}/lines`, line, { 'idempotency-key': KEY_A });
    expect(await stepCount(attemptId)).toBe(1);
  });
});
