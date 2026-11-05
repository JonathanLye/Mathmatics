import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';
import { loadProblem } from '../src/attempts/problem.ts';

import {
  buildTestApp,
  cookieFrom,
  loginBody,
  setupFixture,
  WRITE_HEADERS,
  setStudentAgeBand,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();
const USERNAME = 'c.teacher';
const PASSWORD = 'correct horse battery';
const STUDENT_NO = '2026001';
const ALL_REQUIRED = {
  service: true,
  crossBorderHosting: true,
  crossBorderModel: false,
  monitoring: true,
  research: false,
};

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let teacherCookie: string;
let studentCookie: string;
let classId: string;
let assignmentId: string;
let attemptId: string;

function auth(cookie: string) {
  return { ...WRITE_HEADERS, cookie };
}

async function teacherLogin(username = USERNAME): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function post(cookie: string, path: string, payload?: unknown, contentType = 'application/json') {
  return app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: {
      ...auth(cookie),
      ...(payload === undefined ? {} : { 'content-type': contentType }),
    },
    payload: payload as string | object | Buffer | undefined,
  });
}

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
  teacherCookie = await teacherLogin();

  const created = await post(teacherCookie, '/teacher/classes', { name: '数分 1 班', term: '2026 秋' });
  expect(created.statusCode, created.body).toBe(201);
  classId = created.json().classId as string;
  const inviteCode = created.json().inviteCode as string;

  const roster = await post(teacherCookie, `/teacher/classes/${classId}/roster`, `${STUDENT_NO},张三\n`, 'text/csv');
  expect(roster.statusCode, roster.body).toBe(200);

  const assignment = await post(teacherCookie, '/teacher/assignments', {
    classId,
    problemId: 'epsN',
    version: 1,
    mode: 'practice',
    openAt: new Date(Date.now() - 60_000).toISOString(),
  });
  expect(assignment.statusCode, assignment.body).toBe(201);
  assignmentId = assignment.json().assignmentId as string;

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode, studentNo: STUDENT_NO }),
  });
  expect(login.statusCode, login.body).toBe(200);
  studentCookie = cookieFrom(login.headers['set-cookie']);
  // #64：写接口要求年龄分档。
  await setStudentAgeBand(app, studentCookie);

  await post(studentCookie, '/consents', { version: 'p0-v1', items: ALL_REQUIRED });

  const start = await post(studentCookie, `/student/assignments/${assignmentId}/attempt`);
  expect(start.statusCode, start.body).toBe(200);
  attemptId = start.json().state.attemptId as string;

  expect((await post(studentCookie, `/attempts/${attemptId}/layers/L1/skip`)).statusCode).toBe(200);
  expect((await post(studentCookie, `/attempts/${attemptId}/layers/L2/skip`)).statusCode).toBe(200);
  const line = await post(studentCookie, `/attempts/${attemptId}/lines`, {
    statement: '$|a_n-3|=\\frac{5}{n+2}$',
    justification: '通分',
    input: { provenance: 'keyboard', draftId: '00000000-0000-4000-8000-0000000000d1' },
  });
  expect(line.statusCode, line.body).toBe(200);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('教师看板 /live（#51）', () => {
  it('返回 LiveSnapshot：状态、层漏斗、统计由服务端计算', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/classes/${classId}/live`,
      headers: { cookie: teacherCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const snapshot = res.json();
    contract.validate('LiveSnapshot', snapshot);
    expect(snapshot.assignmentId).toBe(assignmentId);
    expect(snapshot.rows).toHaveLength(1);
    expect(['active', 'idle', 'away']).toContain(snapshot.rows[0].status);
    expect(snapshot.rows[0].layer).toBe('L3');
    expect(snapshot.summary.started).toBe(1);
    expect(snapshot.summary.layerFunnel.L3).toBe(1);
  });

  it('非本班教师 404', async () => {
    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const otherCookie = await teacherLogin('other.teacher');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/classes/${classId}/live`,
      headers: { cookie: otherCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('away 口径 ≥2s：短于 2 秒的切屏不计（11 §2 / #124）', async () => {
    const row = (
      await db.query<{ user_id: string; assignment_id: string; problem_id: string; problem_version: number; anon: string }>(
        `select a.user_id, a.assignment_id, a.problem_id, a.problem_version, u.anon_code as anon
           from app.attempts a join app.users u on u.id = a.user_id where a.id = $1`,
        [attemptId],
      )
    ).rows[0];
    if (!row) throw new Error('attempt missing');
    const insert = (seq: number, payload: Record<string, unknown>) =>
      db.query(
        `insert into ev.events
           (id, seq, type, source, ts_server, user_id, user_anon, role, assignment_id, attempt_id,
            problem_id, problem_version, layer, mode, payload)
         values (gen_random_uuid(), $1, 'integ.visibility', 'server', now(), $2, $3, 'student', $4, $5, $6, $7, 'L3', 'practice', $8::jsonb)`,
        [seq, row.user_id, row.anon, row.assignment_id, attemptId, row.problem_id, row.problem_version, JSON.stringify(payload)],
      );
    await insert(9001, { state: 'hidden' });
    await insert(9002, { state: 'visible', awayMs: 500 });
    await insert(9003, { state: 'hidden' });
    await insert(9004, { state: 'visible', awayMs: 3000 });

    const live = await app.inject({ method: 'GET', url: `/api/v1/teacher/classes/${classId}/live`, headers: { cookie: teacherCookie } });
    expect(live.statusCode, live.body).toBe(200);
    expect(live.json().rows[0].awayCount).toBe(1);

    const metrics = await app.inject({ method: 'GET', url: `/api/v1/teacher/classes/${classId}/metrics`, headers: { cookie: teacherCookie } });
    expect(metrics.json().integrity.awayEventsMedian).toBe(1);
  });

  it('样本 n<10 时比例返回 null，只给人数', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/classes/${classId}/metrics`,
      headers: { cookie: teacherCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const metrics = res.json();
    contract.validate('MetricsView', metrics);
    expect(metrics.n).toBe(1);
    expect(metrics.completionRate).toBeNull();
    expect(metrics.independenceMedian).toBeNull();
    expect(metrics.layerFunnel.L3).toBe(1);
  });
});

describe('教师学生详情 / 事件（#51）', () => {
  it('详情：行、题目、anonCode；notes 为空但 hints 可还原', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/attempts/${attemptId}`,
      headers: { cookie: teacherCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json();
    contract.validate('AttemptDetail', detail);
    expect(detail.problem.title).toContain('数列极限');
    expect(detail.anonCode).toMatch(/^S-/);
    expect(detail.lines).toHaveLength(1);
    expect(detail.notes).toEqual([]);
    expect(Array.isArray(detail.hints)).toBe(true);
    expect(detail.timeline.length).toBeGreaterThan(0);
  });

  it('事件分页：afterSeq/limit + nextSeq；不返回 user_id', async () => {
    const first = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/attempts/${attemptId}/events?limit=3`,
      headers: { cookie: teacherCookie },
    });
    expect(first.statusCode, first.body).toBe(200);
    const page = first.json();
    expect(page.events.length).toBeLessThanOrEqual(3);
    for (const event of page.events) {
      expect(event).toHaveProperty('seq');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('source');
      expect(event).toHaveProperty('tsServer');
      expect(event).toHaveProperty('userAnon');
      expect(event).toHaveProperty('role');
      expect(event).not.toHaveProperty('user_id');
    }
    expect(typeof page.nextSeq).toBe('number');

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/attempts/${attemptId}/events?afterSeq=${page.nextSeq}&limit=100`,
      headers: { cookie: teacherCookie },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().events.every((event: { seq: number }) => event.seq > page.nextSeq)).toBe(true);
  });

  it('学生不能读教师详情接口（403）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/attempts/${attemptId}`,
      headers: { cookie: studentCookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('发一句话 / 处理标记 / 解锁（#51）', () => {
  it('nudge 通过闸门：落 teacher_nudges + t.nudge + audit_log', async () => {
    const res = await post(teacherCookie, `/teacher/attempts/${attemptId}/nudge`, { text: '先看看定义，再想下一步' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ shown: '先看看定义，再想下一步', gated: false });

    const nudge = await db.query<{ text_shown: string; gated: boolean }>(
      `select text_shown, gated from app.teacher_nudges where attempt_id = $1`,
      [attemptId],
    );
    expect(nudge.rows[0]).toMatchObject({ text_shown: '先看看定义，再想下一步', gated: false });
    const events = await db.query(`select 1 from ev.events where attempt_id = $1 and type = 't.nudge'`, [attemptId]);
    expect(events.rows).toHaveLength(1);
    const audit = await db.query(`select 1 from app.audit_log where action = 'nudge' and target = $1`, [attemptId]);
    expect(audit.rows).toHaveLength(1);
  });

  it('nudge 命中未写出关键步骤的 leak：不发送、gated=true', async () => {
    const row = (
      await db.query<{ state: { hint: { matched: string[] } }; problem_id: string; problem_version: number }>(
        `select state, problem_id, problem_version from app.attempts where id = $1`,
        [attemptId],
      )
    ).rows[0];
    if (!row) throw new Error('attempt missing');
    const problem = await loadProblem(db, row.problem_id, row.problem_version);
    const matched = new Set(row.state.hint.matched);
    const key = problem.ctx.pkg.secret.keys.find((item) => !matched.has(item.id));
    const leak = key?.leak[0];
    expect(leak).toBeTruthy();

    const res = await post(teacherCookie, `/teacher/attempts/${attemptId}/nudge`, { text: `提示：${leak}` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ shown: '', gated: true });
    const nudge = await db.query<{ gated: boolean; text_shown: string }>(
      `select gated, text_shown from app.teacher_nudges where attempt_id = $1`,
      [attemptId],
    );
    expect(nudge.rows[0]).toMatchObject({ gated: true, text_shown: '' });
  });

  it('处理求助标记：help_flags + t.resolve_flag + audit', async () => {
    const flag = await db.query<{ id: string }>(
      `insert into app.help_flags (attempt_id, user_id, layer) values ($1, (select user_id from app.attempts where id = $1), 'L3') returning id`,
      [attemptId],
    );
    const flagId = flag.rows[0]?.id as string;
    const res = await post(teacherCookie, `/teacher/flags/${flagId}/resolve`, { disposition: 'noted', note: '课上讲' });
    expect(res.statusCode, res.body).toBe(204);

    const resolved = await db.query<{ resolved_at: Date | null; note: string | null }>(
      `select resolved_at, note from app.help_flags where id = $1`,
      [flagId],
    );
    expect(resolved.rows[0]?.resolved_at).not.toBeNull();
    expect(resolved.rows[0]?.note).toBe('课上讲');
    expect((await db.query(`select 1 from ev.events where attempt_id = $1 and type = 't.resolve_flag'`, [attemptId])).rows).toHaveLength(1);
  });

  it('解锁：锁定时可解并写 attempt.unlock；未锁定时 409', async () => {
    await db.query(`update app.attempts set status = 'locked', locked_reason = 'test' where id = $1`, [attemptId]);
    const res = await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('active');
    expect((await db.query(`select 1 from ev.events where attempt_id = $1 and type = 'attempt.unlock'`, [attemptId])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from app.audit_log where action = 'unlock' and target = $1`, [attemptId])).rows).toHaveLength(1);

    const again = await post(teacherCookie, `/teacher/attempts/${attemptId}/unlock`, {});
    expect(again.statusCode).toBe(409);
  });

  it('教师改判行归类：更新 cls/keys/path=teacher + audit；学生 403、错行 404（#174）', async () => {
    const detail = await app.inject({ method: 'GET', url: `/api/v1/teacher/attempts/${attemptId}`, headers: { cookie: teacherCookie } });
    const lineId = (detail.json() as { lines: Array<{ lineId: string }> }).lines[0]?.lineId as string;
    expect(lineId).toBeTruthy();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/lines/${lineId}/reclassify`,
      headers: auth(teacherCookie),
      payload: { cls: 'match', keys: ['K1'], note: '抽检改判' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lineId, cls: 'match', keys: ['K1'], classifierPath: 'teacher' });

    const stored = await db.query<{ cls: string; classifier_path: string }>(
      `select cls, classifier_path from app.attempt_lines where id = $1`,
      [lineId],
    );
    expect(stored.rows[0]).toMatchObject({ cls: 'match', classifier_path: 'teacher' });
    const audit = await db.query(`select action, detail from app.audit_log where action = 'reclassify_line' and target = $1`, [
      `${attemptId}:${lineId}`,
    ]);
    expect(audit.rows).toHaveLength(1);

    const asStudent = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/lines/${lineId}/reclassify`,
      headers: auth(studentCookie),
      payload: { cls: 'match' },
    });
    expect(asStudent.statusCode, asStudent.body).toBe(403);

    const wrongLine = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/attempts/${attemptId}/lines/00000000-0000-4000-8000-000000000999/reclassify`,
      headers: auth(teacherCookie),
      payload: { cls: 'error', errorId: 'E1' },
    });
    expect(wrongLine.statusCode, wrongLine.body).toBe(404);
  });
});
