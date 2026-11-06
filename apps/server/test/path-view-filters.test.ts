import type { AddressInfo } from 'node:net';

import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
import { buildAttemptsCsv } from '../src/export/attempts-csv.ts';

import { buildTestApp, cookieFrom, loginBody, setStudentAgeBand, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// Task 11：自学布置（origin='path'）出现后，教师看板、布置列表、指标、导出与同学首页必须与没有它时一致。
// 这些过滤先于任何路径数据落地；若这里变红，说明有查询漏了 origin='teacher'。

const PASSWORD = 'correct horse battery';
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let base: string;
let teacherCookie: string;
let classId: string;
let teacherId: string;
let teacherAssignmentId: string;
let pathAssignmentId: string;
const students: { cookie: string; attemptId: string }[] = [];

async function post(cookie: string, path: string, payload?: unknown, contentType = 'application/json') {
  return app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: { ...WRITE_HEADERS, cookie, ...(payload === undefined ? {} : { 'content-type': contentType }) },
    payload: payload as string | object | undefined,
  });
}
const get = (cookie: string, path: string) => app.inject({ method: 'GET', url: `/api/v1${path}`, headers: { cookie } });

async function joinStudent(studentNo: string, inviteCode: string): Promise<string> {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode, studentNo }),
  });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = cookieFrom(login.headers['set-cookie']);
  await setStudentAgeBand(app, cookie);
  await post(cookie, '/consents', { version: 'p0-v1', items: REQUIRED });
  return cookie;
}

async function waitExport(exportId: string): Promise<string> {
  for (let i = 0; i < 80; i += 1) {
    const res = await get(teacherCookie, `/teacher/exports/${exportId}`);
    const job = res.json() as { status: string; url: string | null };
    if (job.status === 'done') return job.url as string;
    if (job.status === 'failed') throw new Error('导出失败');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('导出未完成');
}

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  await createTeacherAccount(db, { username: 'filter.teacher', password: PASSWORD });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username: 'filter.teacher', password: PASSWORD },
  });
  teacherCookie = cookieFrom(login.headers['set-cookie']);
  const created = await post(teacherCookie, '/teacher/classes', { name: '过滤班', term: '2026 秋' });
  classId = created.json().classId as string;
  teacherId = (await db.query<{ owner_id: string }>(`select owner_id from app.classes where id = $1`, [classId])).rows[0]?.owner_id as string;
  await post(teacherCookie, `/teacher/classes/${classId}/roster`, '2026101,甲\n2026102,乙\n', 'text/csv');

  const assignment = await post(teacherCookie, '/teacher/assignments', {
    classId,
    problemId: 'epsN',
    version: 1,
    mode: 'practice',
    openAt: new Date(Date.now() - 3_600_000).toISOString(),
  });
  teacherAssignmentId = assignment.json().assignmentId as string;
  const invite = created.json().inviteCode as string;

  students.length = 0;
  for (const no of ['2026101', '2026102']) {
    const cookie = await joinStudent(no, invite);
    students.push({ cookie, attemptId: '' });
  }
  // 甲做教师布置。
  const started = await post(students[0]!.cookie, `/student/assignments/${teacherAssignmentId}/attempt`);
  expect(started.statusCode, started.body).toBe(200);
  students[0]!.attemptId = started.json().state.attemptId as string;

  // 乙在 series 上有一份自学布置（比教师布置更新，最容易抢走默认看板）。
  const version = (await db.query<{ v: number }>(`select max(version) as v from content.problem_versions where problem_id = 'series'`)).rows[0]?.v;
  pathAssignmentId = (
    await db.query<{ id: string }>(
      `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, origin, created_by)
       values ($1, 'series', $2, 'practice', now() - interval '1 minute', 'open', 'path', $3) returning id`,
      [classId, version, teacherId],
    )
  ).rows[0]?.id as string;
  const own = await post(students[1]!.cookie, `/student/assignments/${pathAssignmentId}/attempt`);
  expect(own.statusCode, own.body).toBe(200);
  students[1]!.attemptId = own.json().state.attemptId as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('origin=path 的布置不污染视图（Task 11）', () => {
  it('同学首页看不到别人的自学布置，自己的路径作答也不进教师布置三栏', async () => {
    const jia = (await get(students[0]!.cookie, '/student/home')).json() as Record<string, { assignmentId: string }[]>;
    const ids = [...jia.inProgress!, ...jia.todo!, ...jia.done!].map((card) => card.assignmentId);
    expect(ids).toEqual([teacherAssignmentId]);

    const yi = (await get(students[1]!.cookie, '/student/home')).json() as Record<string, { assignmentId: string }[]>;
    const yiIds = [...yi.inProgress!, ...yi.todo!, ...yi.done!].map((card) => card.assignmentId);
    // 乙对教师布置还没开始，只应看到教师布置（在 todo），不含任何路径布置。
    expect(yiIds).toEqual([teacherAssignmentId]);
  });

  it('教师默认看板选教师布置而不是更新的自学布置；显式指定自学布置 404', async () => {
    const live = await get(teacherCookie, `/teacher/classes/${classId}/live`);
    expect(live.statusCode, live.body).toBe(200);
    expect(live.json().assignmentId).toBe(teacherAssignmentId);
    expect(live.json().rows).toHaveLength(2);
    expect(live.json().summary.started).toBe(1);

    const explicit = await get(teacherCookie, `/teacher/classes/${classId}/live?assignmentId=${pathAssignmentId}`);
    expect(explicit.statusCode).toBe(404);
  });

  it('教师布置列表不含自学布置；改、发布讲评对自学布置都 404', async () => {
    const list = await get(teacherCookie, `/teacher/assignments?classId=${classId}`);
    expect((list.json() as { assignmentId: string }[]).map((card) => card.assignmentId)).toEqual([teacherAssignmentId]);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teacher/assignments/${pathAssignmentId}`,
      headers: { ...WRITE_HEADERS, cookie: teacherCookie },
      payload: { classId, problemId: 'series', version: 1, mode: 'practice', openAt: new Date().toISOString() },
    });
    expect(patch.statusCode).toBe(404);
    const review = await post(teacherCookie, `/teacher/assignments/${pathAssignmentId}/publish-review`, {});
    expect(review.statusCode).toBe(404);
  });

  it('班级指标只算教师布置的作答', async () => {
    const metrics = await get(teacherCookie, `/teacher/classes/${classId}/metrics`);
    expect(metrics.statusCode, metrics.body).toBe(200);
    expect(metrics.json().n).toBe(1);
    const one = await get(teacherCookie, `/teacher/classes/${classId}/metrics?assignmentId=${teacherAssignmentId}`);
    expect(one.json().n).toBe(1);
  });

  it('导出的 attempts / events / lines 不含自学作答，旧版 attempts CSV 同理', async () => {
    const created = await post(teacherCookie, '/teacher/exports', {
      classId,
      format: 'csv',
      tables: ['attempts', 'events', 'lines', 'recognitions', 'integrity'],
      anonymized: true,
    });
    expect(created.statusCode, created.body).toBe(202);
    const url = await waitExport(created.json().exportId as string);
    const res = await fetch(`${base}${url}`, { headers: { cookie: teacherCookie } });
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const attemptsCsv = (await zip.file('attempts.csv')?.async('string')) ?? '';
    const eventsCsv = (await zip.file('events.csv')?.async('string')) ?? '';
    expect(attemptsCsv.trim().split('\r\n')).toHaveLength(2); // 表头 + 甲的一份
    expect(attemptsCsv).toContain(students[0]!.attemptId);
    expect(attemptsCsv).not.toContain(students[1]!.attemptId);
    expect(eventsCsv).toContain(students[0]!.attemptId);
    expect(eventsCsv).not.toContain(students[1]!.attemptId);
    expect(eventsCsv).not.toContain(pathAssignmentId);

    const legacy = await buildAttemptsCsv(db, classId);
    expect(legacy.trim().split('\n')).toHaveLength(2);
  });

  it('纯路径数据的班级：教师端看板为空而不是借用自学布置', async () => {
    await db.query(`update app.assignments set status = 'cancelled' where id = $1`, [teacherAssignmentId]);
    const live = await get(teacherCookie, `/teacher/classes/${classId}/live`);
    expect(live.statusCode, live.body).toBe(200);
    expect(live.json().assignmentId).toBeNull();
  });
});
