import { serializeState } from '@proof-gym/engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadProblem } from '../src/attempts/problem.ts';
import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
// 引擎的测试替身：用 v3 "需要不断指点"的场景把状态推到额度用尽（reveal 2/2）。只在测试里引用。
import { Runner } from '../../../packages/engine/test/support/runner.ts';
import { K3, K4, SCENARIOS } from '../../../packages/engine/test/support/scenarios.ts';

import {
  buildTestApp,
  cookieFrom,
  loginBody,
  setupFixture,
  setStudentAgeBand,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();
const PASSWORD = 'correct horse battery';
const STUDENT_NO = '2026001';
const ALL_REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherCookie: string;
let studentCookie: string;
let attemptId: string;

async function post(cookie: string, path: string, payload?: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: { ...WRITE_HEADERS, cookie, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    payload: payload as object | undefined,
  });
}

async function login(username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

// 把作答推进到"额度用尽"：白盒写入引擎状态（前面各层的真实交互在别处测过）。
async function exhaust(): Promise<void> {
  const { ctx } = await loadProblem(db, 'epsN', 1);
  const runner = new Runner(ctx);
  for (const action of SCENARIOS.weak.slice(0, 25)) action(runner);
  expect(runner.state.hint.exhausted).toBe(true);
  await db.query(`update app.attempts set state = $2::jsonb, current_layer = 'L3', reveal = $3 where id = $1`, [
    attemptId,
    JSON.stringify(serializeState(runner.state)),
    runner.state.hint.reveal,
  ]);
}

function line(statement: string, justification: string) {
  return post(studentCookie, `/attempts/${attemptId}/lines`, {
    statement,
    justification,
    input: { provenance: 'keyboard', draftId: '00000000-0000-4000-8000-0000000000d1' },
  });
}

async function eventsOf(type: string) {
  return (await db.query<{ payload: Record<string, unknown> }>(`select payload from ev.events where attempt_id = $1 and type = $2 order by seq`, [attemptId, type])).rows;
}

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await createTeacherAccount(db, { username: 'c.teacher', password: PASSWORD });
  teacherCookie = await login('c.teacher');
  const created = await post(teacherCookie, '/teacher/classes', { name: '数分 1 班', term: '2026 秋' });
  const inviteCode = created.json().inviteCode as string;
  const classId = created.json().classId as string;
  await app.inject({
    method: 'POST',
    url: `/api/v1/teacher/classes/${classId}/roster`,
    headers: { ...WRITE_HEADERS, cookie: teacherCookie, 'content-type': 'text/csv' },
    payload: `${STUDENT_NO},张三\n`,
  });
  const assignment = await post(teacherCookie, '/teacher/assignments', {
    classId,
    problemId: 'epsN',
    version: 1,
    mode: 'practice',
    openAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const assignmentId = assignment.json().assignmentId as string;
  const studentLogin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode, studentNo: STUDENT_NO }),
  });
  studentCookie = cookieFrom(studentLogin.headers['set-cookie']);
  await setStudentAgeBand(app, studentCookie);
  await post(studentCookie, '/consents', { version: 'p0-v1', items: ALL_REQUIRED });
  const start = await post(studentCookie, `/student/assignments/${assignmentId}/attempt`);
  attemptId = start.json().state.attemptId as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('软着陆：额度用尽 → 教师 unlock(grantH4) → 学生补依据 → 完成判据闭合（12 §7 第 5 项）', () => {
  it('补发 H4：reveal 不变；学生视图出现 H4 批注；事件 hint.deliver{override} + attempt.unlock{grantH4}；审计留痕', async () => {
    await exhaust();
    const before = (await post(studentCookie, `/attempts/${attemptId}/help`, { intent: 'concept' })).statusCode; // 额度用尽后概念解释仍可用
    expect(before).toBe(200);

    const res = await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: '' });
    expect(res.statusCode, res.body).toBe(200);
    contract.validate('AttemptDetail', res.json());

    const delivered = (await eventsOf('hint.deliver')).filter((e) => e.payload.override === true);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.payload).toMatchObject({ key: 'K3', level: 'H4', revealDelta: 0, revealAfter: 2 });
    expect((await eventsOf('attempt.unlock'))[0]?.payload).toMatchObject({ grantH4: 'K3' });
    expect((await db.query(`select detail from app.audit_log where action = 'unlock' and target = $1`, [attemptId])).rows[0]).toMatchObject({
      detail: { grantH4: 'next' },
    });

    const state = (await app.inject({ method: 'GET', url: `/api/v1/attempts/${attemptId}`, headers: { cookie: studentCookie } })).json().state;
    contract.validate('AttemptState', state);
    expect(state.budget.revealUsed).toBe(2);
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]).toMatchObject({ kind: 'hint', level: 'H4', who: 'H4 · 老师补发' });
    expect(state.notes[0].text).toContain('N');
  });

  it('补发后：依据不足 6 字不计入；补上依据才计入 K3；再写 K4、写完了 → 进入第 4 层', async () => {
    await exhaust();
    expect((await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: 'K3' })).statusCode).toBe(200);

    expect((await line(K3[0], '照抄的')).statusCode).toBe(200);
    const lines = await eventsOf('line.submit');
    expect(lines.at(-1)?.payload).toMatchObject({ cls: 'demo_needs_reason', newKeys: [] });

    expect((await line(K3[0], K3[1])).statusCode).toBe(200);
    expect((await eventsOf('line.submit')).at(-1)?.payload).toMatchObject({ cls: 'match', newKeys: ['K3'] });
    expect((await line(K4[0], K4[1])).statusCode).toBe(200);

    const finished = await post(studentCookie, `/attempts/${attemptId}/finish`);
    expect(finished.statusCode, finished.body).toBe(200);
    expect(finished.json().state.currentLayer).toBe('L4');
    expect(finished.json().state.budget.revealUsed).toBe(2);
  });

  it('锁定中的作答可以同时解锁并补发（状态回到 active，locked_reason 清空）', async () => {
    await exhaust();
    await db.query(`update app.attempts set status = 'locked', locked_reason = 'away' where id = $1`, [attemptId]);
    expect((await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: 'K3' })).statusCode).toBe(200);
    const row = (await db.query(`select status, locked_reason from app.attempts where id = $1`, [attemptId])).rows[0];
    expect(row).toMatchObject({ status: 'active', locked_reason: null });
  });

  it('拒绝：额度没用完 409；步骤不存在 422；同一步补发第二次 422；学生/外班教师不能补发', async () => {
    // 额度没用完（刚开始，第 1 层）
    const early = await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: '' });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toContain('额度');

    await exhaust();
    expect((await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: 'K99' })).statusCode).toBe(422);
    expect((await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: 'K3' })).statusCode).toBe(200);
    expect((await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: 'K3' })).statusCode).toBe(422);

    expect([401, 403]).toContain((await post(studentCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: '' })).statusCode);
    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const otherCookie = await login('other.teacher');
    expect((await post(otherCookie, `/teacher/attempts/${attemptId}/unlock`, { grantH4: 'K4' })).statusCode).toBe(404);
  });

  it('不带 grantH4 的解锁行为不变：未锁定 409', async () => {
    expect((await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, {})).statusCode).toBe(409);
  });
});
