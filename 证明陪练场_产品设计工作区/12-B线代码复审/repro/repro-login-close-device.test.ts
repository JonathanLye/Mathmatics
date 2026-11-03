import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { studentNoHash } from '../src/auth/crypto.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import {
  buildTestApp, cookieFrom, DEVICE_A, loginBody, setupFixture, testConfig, WRITE_HEADERS, type Fixture,
} from './support/fixtures.ts';

const ALL = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };
let fx: Fixture; let db: Db; let app: FastifyInstance; let assignmentId: string;

beforeEach(async () => {
  fx = await setupFixture(); db = fx.db; await seedContent(db); app = await buildTestApp(db);
  const teacher = (await db.query<{ id: string }>(`select id from app.users where role='teacher'`)).rows[0]?.id;
  const v = (await db.query<{ version: number }>(`select max(version) as version from content.problem_versions where problem_id='epsN'`)).rows[0]?.version;
  assignmentId = (await db.query<{ id: string }>(
    `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
     values ($1,'epsN',$2,'practice', now() - interval '1 hour','open',$3) returning id`, [fx.classId, v, teacher])).rows[0]?.id as string;
});
afterEach(async () => { await app.close(); await fx.close(); });

const login = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload });

describe('REPRO', () => {
  it('R1 同一出口 IP 第 11 次登录被限流（校园 NAT 下一个班同时登录）', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) codes.push((await login(loginBody())).statusCode);
    console.log('R1 status codes', codes.join(','));
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });

  it('R2 布置关闭后，作答写接口是否仍可写（06 §5 ASSIGNMENT_CLOSED=只读）', async () => {
    const res = await login(loginBody());
    const cookie = cookieFrom(res.headers['set-cookie']);
    await app.inject({ method: 'POST', url: '/api/v1/consents', headers: { cookie, ...WRITE_HEADERS }, payload: { version: 'p0-v1', items: ALL } });
    const start = await app.inject({ method: 'POST', url: `/api/v1/student/assignments/${assignmentId}/attempt`, headers: { cookie, ...WRITE_HEADERS } });
    const id = start.json().state.attemptId as string;
    await db.query(`update app.assignments set status='closed', close_at = now() - interval '1 minute' where id=$1`, [assignmentId]);
    const park = await app.inject({ method: 'POST', url: `/api/v1/attempts/${id}/park`, headers: { cookie, ...WRITE_HEADERS } });
    console.log('R2 park after close ->', park.statusCode, park.body.slice(0, 120));
    expect(park.statusCode).toBe(409);
  });

  it('R3 同一 deviceId 被第二个学生登录后，设备行改归第二个学生', async () => {
    await db.query(`insert into app.roster_entries (class_id, student_no_hash) values ($1,$2)`, [fx.classId, studentNoHash(testConfig.studentNoPepper, '2026002')]);
    await login(loginBody());
    await login(loginBody({ studentNo: '2026002' }));
    const idOf = async (no: string) => (await db.query<{ user_id: string }>(`select user_id from app.student_profiles where student_no_hash=$1`, [studentNoHash(testConfig.studentNoPepper, no)])).rows[0]?.user_id;
    const a = await idOf('2026001'); const b = await idOf('2026002');
    const owner = (await db.query<{ user_id: string }>(`select user_id from app.devices where id=$1`, [DEVICE_A])).rows[0]?.user_id;
    console.log('R3 owner is B?', owner === b, 'owner is A?', owner === a);
    expect(a).not.toBe(b);
    expect(owner).toBe(b);
  });

  it('R4 同一 POST /lines 重放两次（无 If-Match / 无 Idempotency-Key）会入库几行', async () => {
    const cookie = cookieFrom((await login(loginBody())).headers['set-cookie']);
    await app.inject({ method: 'POST', url: '/api/v1/consents', headers: { cookie, ...WRITE_HEADERS }, payload: { version: 'p0-v1', items: ALL } });
    const start = await app.inject({ method: 'POST', url: `/api/v1/student/assignments/${assignmentId}/attempt`, headers: { cookie, ...WRITE_HEADERS } });
    const id = start.json().state.attemptId as string;
    for (const l of ['L1', 'L2']) await app.inject({ method: 'POST', url: `/api/v1/attempts/${id}/layers/${l}/skip`, headers: { cookie, ...WRITE_HEADERS } });
    const body = { statement: '任取 $\\varepsilon>0$，取 $N=\\lceil 5/\\varepsilon\\rceil$', justification: '由题设', input: { provenance: 'keyboard', draftId: '00000000-0000-4000-8000-0000000000d1' } };
    const headers = { cookie, ...WRITE_HEADERS, 'idempotency-key': '11111111-1111-4111-8111-111111111111' };
    const r1 = await app.inject({ method: 'POST', url: `/api/v1/attempts/${id}/lines`, headers, payload: body });
    const r2 = await app.inject({ method: 'POST', url: `/api/v1/attempts/${id}/lines`, headers, payload: body });
    const n = (await db.query<{ n: string }>(`select count(*)::text n from app.attempt_lines where attempt_id=$1 and role='step'`, [id])).rows[0]?.n;
    console.log('R4 statuses', r1.statusCode, r2.statusCode, 'step lines in db =', n);
    expect(n).toBe('1');
  });
});
