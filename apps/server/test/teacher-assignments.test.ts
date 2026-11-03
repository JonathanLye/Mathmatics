import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import {
  buildTestApp,
  cookieFrom,
  loginBody,
  setupFixture,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();
const USERNAME = 'c.teacher';
const PASSWORD = 'correct horse battery';
const PROBLEM_ID = 'epsN';
const PROBLEM_VERSION = 1;

let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

function auth(cookie: string) {
  return { ...WRITE_HEADERS, cookie };
}

async function teacherLogin(username = USERNAME, password = PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username, password },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function createClass(cookie: string, name = '数分 1 班'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/teacher/classes',
    headers: auth(cookie),
    payload: { name, term: '2026 秋' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().classId as string;
}

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function assignmentBody(classId: string, overrides: Record<string, unknown> = {}) {
  return {
    classId,
    problemId: PROBLEM_ID,
    version: PROBLEM_VERSION,
    mode: 'practice',
    openAt: iso(-60_000),
    ...overrides,
  };
}

describe('布置练习（#50）', () => {
  it('创建：返回 AssignmentCard（题面/标题来自已发布版本），写 t.assign 事件', async () => {
    const cookie = await teacherLogin();
    const classId = await createClass(cookie);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(classId, { closeAt: iso(3600_000), settings: { revealBudget: 1 } }),
    });
    expect(res.statusCode, res.body).toBe(201);
    const card = res.json();
    contract.validate('AssignmentCard', card);
    expect(card).toMatchObject({ title: '数列极限 · ε-N', mode: 'practice', status: 'open' });
    expect(card.stem).toContain('\\varepsilon');

    const events = await db.query<{ seq: string; class_id: string; payload: Record<string, unknown> }>(
      `select seq, class_id, payload from ev.events where type = 't.assign' and assignment_id = $1`,
      [card.assignmentId],
    );
    expect(events.rows).toHaveLength(1);
    expect(Number(events.rows[0]?.seq)).toBe(0);
    expect(events.rows[0]?.class_id).toBe(classId);
    expect(events.rows[0]?.payload).toMatchObject({ assignmentId: card.assignmentId, mode: 'practice' });
  });

  it('只能布置已发布版本（不存在的版本 422）', async () => {
    const cookie = await teacherLogin();
    const classId = await createClass(cookie);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(classId, { version: 999 }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('非本班教师 404；学生 403', async () => {
    const cookie = await teacherLogin();
    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const otherCookie = await teacherLogin('other.teacher');
    const otherClass = await createClass(otherCookie, '别人的班');

    const cross = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(otherClass),
    });
    expect(cross.statusCode).toBe(404);

    const studentLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/student/login',
      headers: WRITE_HEADERS,
      payload: loginBody(),
    });
    const studentCookie = cookieFrom(studentLogin.headers['set-cookie']);
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(studentCookie),
      payload: assignmentBody(await createClass(cookie)),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('修改布置：时间与 settings 生效（AssignmentCreate 全量 body）', async () => {
    const cookie = await teacherLogin();
    const classId = await createClass(cookie);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(classId),
    });
    const assignmentId = created.json().assignmentId as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teacher/assignments/${assignmentId}`,
      headers: auth(cookie),
      payload: assignmentBody(classId, {
        closeAt: iso(3600_000),
        settings: { revealBudget: 1, layers: { L1: true, L2: true, L3: true } },
      }),
    });
    expect(res.statusCode, res.body).toBe(200);
    contract.validate('AssignmentCard', res.json());
    expect(res.json().status).toBe('open');

    const row = await db.query<{ settings: Record<string, unknown>; close_at: Date | null }>(
      `select settings, close_at from app.assignments where id = $1`,
      [assignmentId],
    );
    expect(row.rows[0]?.settings.revealBudget).toBe(1);
    expect(row.rows[0]?.close_at).not.toBeNull();
  });
});

describe('发布讲评（#50 / 04 §6）', () => {
  it('未关闭时 409', async () => {
    const cookie = await teacherLogin();
    const classId = await createClass(cookie);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(classId),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/assignments/${created.json().assignmentId}/publish-review`,
      headers: auth(cookie),
      payload: { proofIds: ['R1'] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('关闭后发布：reviewPublished=true，写 t.publish_review 与 reference_access_log', async () => {
    const cookie = await teacherLogin();
    const classId = await createClass(cookie);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(classId, { openAt: iso(-7_200_000), closeAt: iso(-3_600_000) }),
    });
    expect(created.statusCode, created.body).toBe(201);
    const assignmentId = created.json().assignmentId as string;
    expect(created.json().status).toBe('closed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/assignments/${assignmentId}/publish-review`,
      headers: auth(cookie),
      payload: { proofIds: ['R1'], note: '讲评：注意放缩' },
    });
    expect(res.statusCode, res.body).toBe(200);
    contract.validate('AssignmentCard', res.json());
    expect(res.json().reviewPublished).toBe(true);

    const events = await db.query(`select 1 from ev.events where type = 't.publish_review' and assignment_id = $1`, [
      assignmentId,
    ]);
    expect(events.rows).toHaveLength(1);
    const access = await db.query(
      `select 1 from vault.reference_access_log where problem_id = $1 and version = $2 and purpose = 'publish'`,
      [PROBLEM_ID, PROBLEM_VERSION],
    );
    expect(access.rows).toHaveLength(1);
  });

  it('不可发布的 proofId 422', async () => {
    const cookie = await teacherLogin();
    const classId = await createClass(cookie);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/assignments',
      headers: auth(cookie),
      payload: assignmentBody(classId, { openAt: iso(-7_200_000), closeAt: iso(-3_600_000) }),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/assignments/${created.json().assignmentId}/publish-review`,
      headers: auth(cookie),
      payload: { proofIds: ['NOT_A_PROOF'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});
