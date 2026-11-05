import type { AddressInfo } from 'node:net';

import JSZip from 'jszip';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ExcelJS from 'exceljs';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { sweepExports } from '../src/services/teacher/exports.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, loginBody, setStudentAgeBand, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

const USERNAME = 'export.teacher';
const PASSWORD = 'correct horse battery';
const STUDENT_NO = '2026007';
const REQUIRED = { service: true, crossBorderHosting: true, crossBorderModel: false, monitoring: true, research: false };

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let base: string;
let teacherCookie: string;
let classId: string;

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
    headers: { ...WRITE_HEADERS, cookie, ...(payload === undefined ? {} : { 'content-type': contentType }) },
    payload: payload as string | object | undefined,
  });
}

async function waitDone(exportId: string): Promise<{ status: string; url: string | null; rows: number | null }> {
  for (let i = 0; i < 80; i += 1) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${exportId}`, headers: { cookie: teacherCookie } });
    expect(res.statusCode, res.body).toBe(200);
    const job = res.json() as { status: string; url: string | null; rows: number | null };
    if (['done', 'failed', 'pending_approval'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('导出任务未在 4s 内完成');
}

let studentCookie: string;
let attemptId: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
  teacherCookie = await teacherLogin();
  const created = await post(teacherCookie, '/teacher/classes', { name: '导出班', term: '2026 秋' });
  expect(created.statusCode, created.body).toBe(201);
  classId = created.json().classId as string;
  expect((await post(teacherCookie, `/teacher/classes/${classId}/roster`, `${STUDENT_NO},导出学生\n`, 'text/csv')).statusCode).toBe(200);
  const assignment = await post(teacherCookie, '/teacher/assignments', {
    classId,
    problemId: 'epsN',
    version: 1,
    mode: 'practice',
    openAt: new Date(Date.now() - 60_000).toISOString(),
  });
  expect(assignment.statusCode, assignment.body).toBe(201);

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode: created.json().inviteCode as string, studentNo: STUDENT_NO }),
  });
  expect(login.statusCode, login.body).toBe(200);
  studentCookie = cookieFrom(login.headers['set-cookie']);
  await setStudentAgeBand(app, studentCookie);
  await post(studentCookie, '/consents', { version: 'p0-v1', items: REQUIRED });
  const started = await post(studentCookie, `/student/assignments/${assignment.json().assignmentId as string}/attempt`);
  expect(started.statusCode, started.body).toBe(200);
  attemptId = started.json().state.attemptId as string;
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('导出任务（#35 / 04 §9 / 08 §5）', () => {
  it('CSV 导出：queued → done，下载 zip（含字段字典），行数 ≥1', async () => {
    const created = await post(teacherCookie, '/teacher/exports', {
      classId,
      format: 'csv',
      tables: ['attempts', 'lines', 'events'],
      anonymized: true,
    });
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json() as { exportId: string; status: string };
    expect(job.status).toBe('queued');
    const done = await waitDone(job.exportId);
    expect(done.status).toBe('done');
    expect(done.url).toBe(`/api/v1/teacher/exports/${job.exportId}/download`);
    expect(done.rows).toBeGreaterThanOrEqual(1);

    const download = await fetch(`${base}${done.url}`, { headers: { cookie: teacherCookie } });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('zip');
    const body = Buffer.from(await download.arrayBuffer());
    expect(body.subarray(0, 2).toString()).toBe('PK');

    // 内容与字典：events.csv 非空、每表字典 + 汇总字典、attempts 含 08 §5 关键列/away 口径。
    const zip = await JSZip.loadAsync(body);
    const eventsCsv = await zip.file('events.csv')?.async('string');
    expect(eventsCsv).toBeTruthy();
    expect(eventsCsv?.split('\r\n')[0]).toContain('attempt_id');
    expect(eventsCsv?.trim().split('\r\n').length).toBeGreaterThan(1);
    expect(zip.file('attempts.dictionary.csv')).toBeTruthy();
    expect(zip.file('dictionary.csv')).toBeTruthy();
    const attemptsCsv = (await zip.file('attempts.csv')?.async('string')) ?? '';
    const header = attemptsCsv.split('\r\n')[0] ?? '';
    expect(header).toContain('away_count');
    expect(header).toContain('away_s');
    expect(header).toContain('chapter');

    const audits = await db.query(`select action from app.audit_log where target = $1 order by at`, [job.exportId]);
    expect(audits.rows.map((row) => row.action)).toEqual(['export_create', 'export_download']);
  });

  it('实名导出 → pending_approval，不生成文件；未知表 422', async () => {
    const created = await post(teacherCookie, '/teacher/exports', {
      classId,
      format: 'csv',
      tables: ['attempts'],
      anonymized: false,
    });
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json() as { exportId: string; status: string };
    expect(job.status).toBe('pending_approval');
    const status = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${job.exportId}`, headers: { cookie: teacherCookie } });
    expect((status.json() as { url: string | null }).url).toBeNull();

    const bad = await post(teacherCookie, '/teacher/exports', { classId, format: 'csv', tables: ['nope'] });
    expect(bad.statusCode, bad.body).toBe(422);

    const badUuid = await post(teacherCookie, '/teacher/exports', { classId: 'not-a-uuid', format: 'csv', tables: ['attempts'] });
    expect(badUuid.statusCode, badUuid.body).toBe(422);
  });

  it('非本班教师 404；其他教师看不到他人导出', async () => {
    await createTeacherAccount(db, { username: 'export.other', password: PASSWORD });
    const other = await teacherLogin('export.other');
    const forbidden = await post(other, '/teacher/exports', { classId, format: 'csv', tables: ['attempts'] });
    expect(forbidden.statusCode).toBe(404);

    const created = await post(teacherCookie, '/teacher/exports', { classId, format: 'csv', tables: ['attempts'] });
    const job = created.json() as { exportId: string };
    const hide = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${job.exportId}`, headers: { cookie: other } });
    expect(hide.statusCode).toBe(404);
    // 等后台导出完成再结束测试，避免 afterEach 关闭 PGlite 后 setImmediate 仍在跑。
    await waitDone(job.exportId);
  });

  async function exportAndUnzip(format: 'csv' | 'jsonl', tables: string[]) {
    const created = await post(teacherCookie, '/teacher/exports', { classId, format, tables });
    expect(created.statusCode, created.body).toBe(202);
    const job = created.json() as { exportId: string };
    const done = await waitDone(job.exportId);
    expect(done.status).toBe('done');
    const res = await fetch(`${base}${done.url}`, { headers: { cookie: teacherCookie } });
    return { exportId: job.exportId, url: done.url as string, zip: await JSZip.loadAsync(Buffer.from(await res.arrayBuffer())) };
  }

  it('attempts 的 ★ 字段：role 中文口径、submissions 计各层提交、lines 不含已删除行（08 §5.1）', async () => {
    expect((await post(studentCookie, `/attempts/${attemptId}/layers/L1/skip`, {})).statusCode).toBe(200);
    expect((await post(studentCookie, `/attempts/${attemptId}/layers/L2/skip`, {})).statusCode).toBe(200);
    for (const [draft, statement] of [['e1', '取 ε'], ['e2', '取 N']] as const) {
      const line = await post(studentCookie, `/attempts/${attemptId}/lines`, {
        statement,
        justification: '由题设',
        input: { provenance: 'keyboard', draftId: `00000000-0000-4000-8000-0000000000${draft}` },
      });
      expect(line.statusCode, line.body).toBe(200);
    }
    await db.query(
      `update app.attempt_lines set deleted_at = now()
        where id = (select id from app.attempt_lines where attempt_id = $1 and role = 'step' order by idx limit 1)`,
      [attemptId],
    );
    const { zip } = await exportAndUnzip('csv', ['attempts']);
    const attempts = (await zip.file('attempts.csv')?.async('string')) ?? '';
    const [header, first] = attempts.replace(/^\uFEFF/, '').split('\r\n');
    const columns = (header ?? '').split(',');
    const values = (first ?? '').split(',');
    expect(values[columns.indexOf('role')]).toBe('必做');
    expect(values[columns.indexOf('submissions')]).toBe('2');
    expect(values[columns.indexOf('lines')]).toBe('1');
  });

  it('CSV：jsonb 列是 JSON 而不是 [object Object]；attempts 带 attempt_id 能与 lines/events 关联', async () => {
    const { zip } = await exportAndUnzip('csv', ['attempts', 'events']);
    const events = (await zip.file('events.csv')?.async('string')) ?? '';
    expect(events).not.toContain('[object Object]');
    const attempts = (await zip.file('attempts.csv')?.async('string')) ?? '';
    const [header, first] = attempts.replace(/^\uFEFF/, '').split('\r\n');
    const columns = (header ?? '').split(',');
    const attemptId = (first ?? '').split(',')[columns.indexOf('attempt_id')];
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(events).toContain(attemptId as string);
    // 这些列数据已有，应导出 0 而不是留空
    for (const column of ['hints_total', 'help_stuck', 'pressure_count', 'recog_requests']) {
      expect((first ?? '').split(',')[columns.indexOf(column)], column).toBe('0');
    }
  });

  it('公式注入：半角/全角开头的学生文本都被转义；xlsx 写成文本单元格', async () => {
    const attempt = await db.query<{ id: string }>(`select id from app.attempts limit 1`);
    const attemptId = attempt.rows[0]?.id;
    for (const [idx, statement] of ['=HYPERLINK("http://x")', '＝1+1', '@SUM(1)'].entries()) {
      await db.query(
        `insert into app.attempt_lines (attempt_id, layer, role, idx, statement, statement_canon, provenance)
         values ($1, 'L3', 'step', $2, $3, 'x', 'keyboard')`,
        [attemptId, idx + 1, statement],
      );
    }
    const { zip } = await exportAndUnzip('csv', ['lines']);
    const lines = (await zip.file('lines.csv')?.async('string')) ?? '';
    expect(lines).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines).toContain(`'＝1+1`);
    expect(lines).toContain(`'@SUM(1)`);

    const created = await post(teacherCookie, '/teacher/exports', { classId, format: 'xlsx', tables: ['lines'] });
    const done = await waitDone((created.json() as { exportId: string }).exportId);
    expect(done.status).toBe('done');
    const res = await fetch(`${base}${done.url}`, { headers: { cookie: teacherCookie } });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as never);
    const sheet = workbook.getWorksheet('lines');
    const statementCol = (sheet?.getRow(1).values as unknown[]).indexOf('statement');
    const cell = sheet?.getRow(2).getCell(statementCol);
    expect(cell?.type).toBe(ExcelJS.ValueType.String);
    expect(cell?.value).toBe('=HYPERLINK("http://x")');
  });

  it('教师被移出班级后不能再查询或下载之前的导出', async () => {
    const { exportId, url } = await exportAndUnzip('csv', ['attempts']);
    await createTeacherAccount(db, { username: 'export.next', password: PASSWORD });
    await db.query(
      `update app.classes set owner_id = (select u.id from app.teacher_accounts t join app.users u on u.id = t.user_id where t.username = 'export.next') where id = $1`,
      [classId],
    );
    await db.query(`delete from app.class_members where class_id = $1 and role = 'teacher'`, [classId]);
    const status = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${exportId}`, headers: { cookie: teacherCookie } });
    expect(status.statusCode).toBe(404);
    expect((await fetch(`${base}${url}`, { headers: { cookie: teacherCookie } })).status).toBe(404);
  });

  it('过期清理：超过 24 小时删除文件并标 expired；遗留的 running 标 failed', async () => {
    const { exportId, url } = await exportAndUnzip('csv', ['attempts']);
    await db.query(`update app.exports set finished_at = now() - interval '25 hours' where id = $1`, [exportId]);
    const stale = await post(teacherCookie, '/teacher/exports', { classId, format: 'csv', tables: ['attempts'] });
    const staleId = (stale.json() as { exportId: string }).exportId;
    await waitDone(staleId);
    await db.query(`update app.exports set status = 'running', created_at = now() - interval '2 hours' where id = $1`, [staleId]);

    await sweepExports(db);

    const expired = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${exportId}`, headers: { cookie: teacherCookie } });
    expect(expired.json()).toMatchObject({ status: 'expired', url: null });
    expect((await fetch(`${base}${url}`, { headers: { cookie: teacherCookie } })).status).toBe(404);
    const failed = await app.inject({ method: 'GET', url: `/api/v1/teacher/exports/${staleId}`, headers: { cookie: teacherCookie } });
    expect(failed.json()).toMatchObject({ status: 'failed' });
  });

  it('实名导出：教师不能审批、管理员审批后生成 name 列；匿名导出不含 name（#35 / 04 §9）', async () => {
    await createTeacherAccount(db, { username: 'admin.export', password: PASSWORD });
    await db.query(
      `update app.users u set role = 'admin'
         from app.teacher_accounts t
        where t.user_id = u.id and t.username = 'admin.export'`,
    );
    const adminCookie = await teacherLogin('admin.export');

    const created = await post(teacherCookie, '/teacher/exports', {
      classId,
      format: 'csv',
      tables: ['attempts'],
      anonymized: false,
    });
    expect(created.statusCode, created.body).toBe(202);
    const exportId = (created.json() as { exportId: string }).exportId;
    expect(created.json().status).toBe('pending_approval');

    const denied = await post(teacherCookie, `/teacher/exports/${exportId}/approve`);
    expect(denied.statusCode, denied.body).toBe(403);

    const approved = await post(adminCookie, `/teacher/exports/${exportId}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().status).toBe('queued');

    const done = await waitDone(exportId);
    expect(done.status).toBe('done');
    const download = await fetch(`${base}${done.url}`, { headers: { cookie: teacherCookie } });
    const zip = await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()));
    const attemptsCsv = (await zip.file('attempts.csv')?.async('string')) ?? '';
    const header = attemptsCsv.split('\r\n')[0] ?? '';
    expect(header).toContain('name');
    expect(attemptsCsv).toContain('导出学生');
    const dictionary = (await zip.file('attempts.dictionary.csv')?.async('string')) ?? '';
    expect(dictionary).toContain('name');

    const audits = await db.query(`select action from app.audit_log where action = 'export_approve' and target = $1`, [exportId]);
    expect(audits.rows).toHaveLength(1);
    const approvedBy = await db.query<{ approved_by: string | null }>(`select approved_by from app.exports where id = $1`, [exportId]);
    expect(approvedBy.rows[0]?.approved_by).toBeTruthy();

    // 匿名导出仍严格按 08 §5：不含 name 列。
    const anonymous = await post(teacherCookie, '/teacher/exports', { classId, format: 'csv', tables: ['attempts'] });
    const anonDone = await waitDone((anonymous.json() as { exportId: string }).exportId);
    const anonZip = await JSZip.loadAsync(Buffer.from(await (await fetch(`${base}${anonDone.url}`, { headers: { cookie: teacherCookie } })).arrayBuffer()));
    const anonHeader = ((await anonZip.file('attempts.csv')?.async('string')) ?? '').split('\r\n')[0] ?? '';
    expect(anonHeader).not.toContain('name');
  });
});
