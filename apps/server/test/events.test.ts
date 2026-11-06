import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSession, SESSION_COOKIE, STUDENT_SESSION_MS } from '../src/auth/session.ts';
import { CLIENT_EVENT_TYPES } from '../src/events/client-schema.ts';
import { TEACHER_CLIENT_TYPES } from '../src/events/ingest.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import {
  buildTestApp,
  cookieFrom,
  DEVICE_A,
  DEVICE_B,
  loginBody,
  setupFixture,
  WRITE_HEADERS,
  setStudentAgeBand,
  type Fixture,
} from './support/fixtures.ts';

const SESSION_ID = '6f1b2c4e-8d3a-4b7e-9c10-2a5d7e8f9a02';
const ALL_REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
const here = path.dirname(fileURLToPath(import.meta.url));

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherId: string;
let assignmentId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  teacherId = (await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`)).rows[0]?.id as string;
  const version = (
    await db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id = 'epsN'`)
  ).rows[0]?.version;
  assignmentId = (
    await db.query<{ id: string }>(
      `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
       values ($1, 'epsN', $2, 'practice', now() - interval '1 hour', 'open', $3) returning id`,
      [fx.classId, version, teacherId],
    )
  ).rows[0]?.id as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function studentCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  return cookieFrom(res.headers['set-cookie']);
}

async function signConsent(cookie: string): Promise<void> {
  // #64：写接口要求年龄分档；测试默认 ge18。
  await setStudentAgeBand(app, cookie);
  await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { version: 'v2', items: ALL_REQUIRED },
  });
}

async function teacherCookie(): Promise<string> {
  await db.query(`insert into app.devices (id, user_id) values ($1, $2)`, [DEVICE_B, teacherId]);
  const session = await createSession(db, { userId: teacherId, deviceId: DEVICE_B, ip: null, ttlMs: STUDENT_SESSION_MS });
  return `${SESSION_COOKIE}=${app.signCookie(session.id)}`;
}

async function startAttempt(cookie: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/student/assignments/${assignmentId}/attempt`,
    headers: { cookie, ...WRITE_HEADERS },
  });
  return res.json().state.attemptId as string;
}

// 一个合法的客户端事件；覆盖项用于构造坏事件。
const event = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  type: 'app.open',
  tsClient: '2026-11-03T04:00:00.000Z',
  sessionId: SESSION_ID,
  deviceId: DEVICE_A,
  clientSeq: 1,
  payload: { entry: 'direct' },
  ...overrides,
});

function postBatch(cookie: string, events: unknown[]) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/events/batch',
    headers: { cookie, ...WRITE_HEADERS },
    payload: { events },
  });
}

const countEvents = async (where: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from ev.events where ${where}`, params)).rows[0]?.n ?? 0;

describe('事件入库 /events/batch（#20）', () => {
  it('合法的 app.open 入库：信封补全（source、user_anon、ts_client、client_seq、seq=0）', async () => {
    const cookie = await studentCookie();
    const e = event();
    const res = await postBatch(cookie, [e]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: 1, duplicates: 0, rejected: [] });

    const row = await db.query<Record<string, unknown>>(
      `select type, source, role, seq, user_anon, ts_client, session_id, device_id, client_seq, payload
         from ev.events where id = $1`,
      [e.id],
    );
    const anon = (await db.query<{ anon_code: string }>(`select anon_code from app.users where role = 'student'`)).rows[0]
      ?.anon_code;
    expect(row.rows[0]).toMatchObject({
      type: 'app.open',
      source: 'student',
      role: 'student',
      seq: 0,
      user_anon: anon,
      session_id: SESSION_ID,
      device_id: DEVICE_A,
      client_seq: 1,
      payload: { entry: 'direct' },
    });
  });

  it('重复上报不重复入库：同一批再发一次，只计 duplicates，ev.events 行数不变', async () => {
    const cookie = await studentCookie();
    const batch = [event(), event()];
    expect((await postBatch(cookie, batch)).json()).toMatchObject({ accepted: 2, duplicates: 0 });
    const again = await postBatch(cookie, batch);
    expect(again.json()).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    expect(await countEvents(`type = 'app.open'`)).toBe(2);
  });

  it('伪造 hint.deliver 被拒：即使带的是学生自己的作答 ID，也因类型不属于客户端而拒收', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const attemptId = await startAttempt(cookie);
    const forged = event({
      type: 'hint.deliver',
      attemptId,
      layer: 'L3',
      payload: { hintId: 'K2.H2', key: 'K2', level: 'H2', cost: 0.5, revealDelta: 0.5, revealAfter: 0.5 },
    });
    const res = await postBatch(cookie, [forged]);
    expect(res.json()).toEqual({ accepted: 0, duplicates: 0, rejected: [{ id: forged.id, reason: 'not_client_type' }] });
    expect(await countEvents(`id = $1`, [forged.id])).toBe(0);
  });

  it('学生上报教师端类型（t.view）被拒：wrong_role；教师账号上报同一类型则接受，source=teacher', async () => {
    const cookie = await studentCookie();
    const tview = event({ type: 't.view', payload: { page: 'attempt' } });
    expect((await postBatch(cookie, [tview])).json().rejected).toEqual([{ id: tview.id, reason: 'wrong_role' }]);

    const teacher = await teacherCookie();
    const ok = event({ type: 't.view', payload: { page: 'attempt' } });
    expect((await postBatch(teacher, [ok])).json()).toMatchObject({ accepted: 1 });
    const row = await db.query<{ source: string }>(`select source from ev.events where id = $1`, [ok.id]);
    expect(row.rows[0]?.source).toBe('teacher');
  });

  it('他人的作答 ID 被拒：attempt_not_found，不写入', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const attemptId = await startAttempt(cookie);
    await db.query(`update app.attempts set user_id = $2 where id = $1`, [attemptId, teacherId]);
    const e = event({ type: 'integ.blur', attemptId, layer: 'L1', payload: { awayMs: 1200 } });
    expect((await postBatch(cookie, [e])).json().rejected).toEqual([{ id: e.id, reason: 'attempt_not_found' }]);
    expect(await countEvents(`id = $1`, [e.id])).toBe(0);
  });

  it('非本班教师上报 t.view 被拒：不能推进别的班作答的事件 seq（P1-8）', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const attemptId = await startAttempt(cookie);
    const beforeSeq = (
      await db.query<{ last_event_seq: string | number }>(`select last_event_seq from app.attempts where id = $1`, [attemptId])
    ).rows[0]?.last_event_seq;

    // 另一个教师（不拥有/不在 fixture 班的班级里）。
    const other = await db.query<{ id: string }>(
      `insert into app.users (role, anon_code) values ('teacher', 'T-OTHER1') returning id`,
    );
    const otherId = other.rows[0]?.id as string;
    await db.query(`insert into app.devices (id, user_id) values ($1, $2)`, [DEVICE_B, otherId]);
    const session = await createSession(db, { userId: otherId, deviceId: DEVICE_B, ip: null, ttlMs: STUDENT_SESSION_MS });
    const otherCookie = `${SESSION_COOKIE}=${app.signCookie(session.id)}`;

    const e = event({ type: 't.view', attemptId, payload: { page: 'attempt' } });
    const res = await postBatch(otherCookie, [e]);
    expect(res.json().rejected).toEqual([{ id: e.id, reason: 'attempt_not_found' }]);
    expect(await countEvents(`id = $1`, [e.id])).toBe(0);
    const afterSeq = (
      await db.query<{ last_event_seq: string | number }>(`select last_event_seq from app.attempts where id = $1`, [attemptId])
    ).rows[0]?.last_event_seq;
    expect(Number(afterSeq)).toBe(Number(beforeSeq));
  });

  it('结构不合法被拒：payload 缺必填字段（app.open 缺 entry）；信封里带服务端字段（source、seq、userAnon）', async () => {
    const cookie = await studentCookie();
    const noEntry = event({ payload: {} });
    const spoofedEnvelope = event({ source: 'server', seq: 99, userAnon: 'X-000' });
    const res = await postBatch(cookie, [noEntry, spoofedEnvelope]);
    expect(res.json().rejected).toEqual([
      { id: noEntry.id, reason: 'schema' },
      { id: spoofedEnvelope.id, reason: 'schema' },
    ]);
    expect(res.json().accepted).toBe(0);
  });

  it('部分接受：一批里的坏事件不影响其它条目', async () => {
    const cookie = await studentCookie();
    const good = event();
    const bad = event({ type: 'hint.deliver' });
    const res = await postBatch(cookie, [good, bad]);
    expect(res.json()).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: [{ id: bad.id, reason: 'not_client_type' }],
    });
  });

  it('未签同意书：过程监测类型（integ.blur）被拒（consent_required）；app.open 等打开应用的事件允许', async () => {
    const cookie = await studentCookie();
    const blur = event({ type: 'integ.blur', payload: { awayMs: 500 } });
    const open = event();
    const res = await postBatch(cookie, [blur, open]);
    expect(res.json()).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: [{ id: blur.id, reason: 'consent_required' }],
    });
  });

  it('作答事件预留 seq：同一作答的 last_event_seq 按条数递增，state_version 不变（不影响 If-Match）', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    const attemptId = await startAttempt(cookie);
    const before = (
      await db.query<{ last_event_seq: number | string; state_version: number }>(
        `select last_event_seq, state_version from app.attempts where id = $1`,
        [attemptId],
      )
    ).rows[0];

    const batch = [
      event({ type: 'integ.blur', attemptId, layer: 'L1', payload: { awayMs: 100 } }),
      event({ type: 'integ.blur', attemptId, layer: 'L1', payload: { awayMs: 200 } }),
    ];
    expect((await postBatch(cookie, batch)).json()).toMatchObject({ accepted: 2 });

    const after = (
      await db.query<{ last_event_seq: number | string; state_version: number }>(
        `select last_event_seq, state_version from app.attempts where id = $1`,
        [attemptId],
      )
    ).rows[0];
    expect(Number(after?.last_event_seq)).toBe(Number(before?.last_event_seq) + 2);
    expect(after?.state_version).toBe(before?.state_version);

    const seqs = await db.query<{ seq: number }>(
      `select seq from ev.events where attempt_id = $1 and type = 'integ.blur' order by seq`,
      [attemptId],
    );
    expect(seqs.rows.map((r) => Number(r.seq))).toEqual([Number(after?.last_event_seq) - 1, Number(after?.last_event_seq)]);
  });

  it('另一个账号重放同一个 id：计为 duplicates，什么都不写', async () => {
    const student = await studentCookie();
    const e = event();
    expect((await postBatch(student, [e])).json()).toMatchObject({ accepted: 1 });

    const teacher = await teacherCookie();
    const replay = await postBatch(teacher, [e]);
    expect(replay.json()).toEqual({ accepted: 0, duplicates: 1, rejected: [] });
    expect(await countEvents(`id = $1`, [e.id])).toBe(1);
  });

  it('超过 100 条：422 VALIDATION_FAILED（信封错误，整批）', async () => {
    const cookie = await studentCookie();
    const res = await postBatch(cookie, Array.from({ length: 101 }, () => event()));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('超过 256KB：413；错误码为框架的 BAD_REQUEST（共享错误处理器未映射 413）', async () => {
    const cookie = await studentCookie();
    const big = event({ type: 'sys.error', payload: { code: 'x', where: 'y'.repeat(300 * 1024) } });
    const res = await postBatch(cookie, [big]);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('BAD_REQUEST');
  });

  it('类型集合与事件目录一致：服务端的客户端类型枚举、教师端类型与 events-catalog 的"产生方"列一致', async () => {
    const catalogPath = path.resolve(here, '../../../证明陪练场_产品设计工作区/10-开发文档/contracts/tools/events-catalog.mjs');
    const { CATALOG } = (await import(pathToFileURL(catalogPath).href)) as {
      CATALOG: [string, string, ...unknown[]][];
    };
    const producersOf = (producer: string) => CATALOG.filter((row) => row[1] === producer).map((row) => row[0]).sort();

    expect([...TEACHER_CLIENT_TYPES].sort()).toEqual(producersOf('teacher'));
    expect([...CLIENT_EVENT_TYPES].sort()).toEqual([...producersOf('student'), ...producersOf('teacher')].sort());
  });
});
