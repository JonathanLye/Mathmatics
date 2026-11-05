import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
import { ATTEMPTS_COLUMNS, buildAttemptsCsv, csvField } from '../src/export/attempts-csv.ts';
import { computeAttemptMetrics } from '../src/metrics/attempt.ts';
import { refreshAttemptMetrics, refreshStaleMetrics } from '../src/metrics/refresh.ts';

import { buildTestApp, cookieFrom, loginBody, setupFixture, WRITE_HEADERS, setStudentAgeBand, type Fixture } from './support/fixtures.ts';

const SESSION_ID = randomUUID();
const DEVICE = randomUUID();

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

async function studentAttempt(): Promise<{ cookie: string; id: string }> {
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody() });
  const cookie = cookieFrom(login.headers['set-cookie']);
  await setStudentAgeBand(app, cookie);
  await app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS },
    payload: {
      version: 'p0-v1',
      items: { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false },
    },
  });
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/student/assignments/${assignmentId}/attempt`,
    headers: { cookie, ...WRITE_HEADERS },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { cookie, id: res.json().state.attemptId as string };
}

function visibility(attemptId: string, state: 'hidden' | 'visible', awayMs?: number) {
  return {
    id: randomUUID(),
    type: 'integ.visibility',
    tsClient: '2026-11-03T04:00:00.000Z',
    sessionId: SESSION_ID,
    deviceId: DEVICE,
    clientSeq: 1,
    attemptId,
    payload: state === 'visible' ? { state, awayMs } : { state },
  };
}

describe('作答级指标（08 §4.1 的子集）', () => {
  it('离开次数取 hidden 的次数；离开时长取 visible 的 awayMs 之和；未完成时 completed 为 false', async () => {
    const { cookie, id } = await studentAttempt();
    await app.inject({
      method: 'POST',
      url: '/api/v1/events/batch',
      headers: { cookie, ...WRITE_HEADERS },
      payload: { events: [visibility(id, 'hidden'), visibility(id, 'visible', 2500), visibility(id, 'hidden'), visibility(id, 'visible', 4000)] },
    });
    const metrics = await computeAttemptMetrics(db, id);
    expect(metrics).toMatchObject({ completed: false, durationMs: null, awayCount: 2, awayMs: 6500, lines: 0, defAttempts: 0 });
  });

  it('refreshAttemptMetrics 把结果写入 app.attempt_metrics，重复刷新覆盖同一行', async () => {
    const { cookie, id } = await studentAttempt();
    await app.inject({
      method: 'POST',
      url: '/api/v1/events/batch',
      headers: { cookie, ...WRITE_HEADERS },
      payload: { events: [visibility(id, 'hidden')] },
    });
    expect(await refreshAttemptMetrics(db, [id, id])).toBe(1);
    expect(await refreshAttemptMetrics(db, [id])).toBe(1);
    const rows = await db.query<{ n: string; metrics: { awayCount: number } }>(
      `select count(*) over ()::text as n, metrics from app.attempt_metrics where attempt_id = $1`,
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.metrics.awayCount).toBe(1);
  });
});

describe('refreshStaleMetrics：定时刷新只算需要算的作答', () => {
  it('没算过的作答会被算；已是最新的跳过；之后又有新事件才再算', async () => {
    const { cookie, id } = await studentAttempt();
    const send = (state: 'hidden' | 'visible') =>
      app.inject({ method: 'POST', url: '/api/v1/events/batch', headers: { cookie, ...WRITE_HEADERS }, payload: { events: [visibility(id, state)] } });
    await send('hidden');
    expect(await refreshStaleMetrics(db)).toBe(1);
    const first = (await db.query<{ metrics: { awayCount: number } }>(`select metrics from app.attempt_metrics where attempt_id = $1`, [id])).rows[0];
    expect(first?.metrics.awayCount).toBe(1);

    expect(await refreshStaleMetrics(db)).toBe(0); // 没有新事件：不重复算
    await new Promise((resolve) => setTimeout(resolve, 20)); // ts_server 要晚于 computed_at
    await send('visible');
    expect(await refreshStaleMetrics(db)).toBe(1);
  });

  it('limit 限制单轮数量', async () => {
    await studentAttempt();
    expect(await refreshStaleMetrics(db, 0)).toBe(0);
  });
});

describe('作答汇总表 CSV（08 §5.1 字段子集）', () => {
  it('UTF-8 BOM 开头；表头与 ATTEMPTS_COLUMNS 一致；每行只含匿名码，不含用户 ID', async () => {
    const { cookie, id } = await studentAttempt();
    await app.inject({
      method: 'POST',
      url: '/api/v1/events/batch',
      headers: { cookie, ...WRITE_HEADERS },
      payload: { events: [visibility(id, 'hidden')] },
    });
    const csv = await buildAttemptsCsv(db, fx.classId);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = csv.slice(1).trimEnd().split('\r\n');
    expect(header).toBe(ATTEMPTS_COLUMNS.join(','));
    const anon = (await db.query<{ anon_code: string }>(`select anon_code from app.users where role = 'student' limit 1`)).rows[0]?.anon_code;
    const userId = (await db.query<{ id: string }>(`select id from app.users where role = 'student' limit 1`)).rows[0]?.id;
    expect(row?.startsWith(`${anon},`)).toBe(true);
    expect(csv).not.toContain(userId as string);
    expect(row?.split(',')[ATTEMPTS_COLUMNS.indexOf('away_count')]).toBe('1');
  });

  it('csvField：含逗号、引号、换行的字段加双引号，内部引号加倍；空值为空串', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('x\ny')).toBe('"x\ny"');
    expect(csvField(null)).toBe('');
    expect(csvField(false)).toBe('false');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('@a')).toBe("'@a");
    expect(csvField('-x')).toBe("'-x");
    expect(csvField(-3)).toBe('-3');
  });
});
