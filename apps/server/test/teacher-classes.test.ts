import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decryptPii, studentNoHash } from '../src/auth/crypto.ts';
import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import { loadContract } from '../src/contract.ts';
import { listClasses } from '../src/services/teacher/classes.ts';
import type { Db } from '../src/db/index.ts';

import {
  buildTestApp,
  cookieFrom,
  loginBody,
  setupFixture,
  testConfig,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();
const USERNAME = 'c.teacher';
const PASSWORD = 'correct horse battery';
const INVITE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
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

async function studentLogin(inviteCode: string, studentNo = '2026001', deviceId?: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody({ inviteCode, studentNo, ...(deviceId === undefined ? {} : { deviceId }) }),
  });
  expect(res.statusCode, res.body).toBe(200);
  return cookieFrom(res.headers['set-cookie']);
}

async function createClass(cookie: string, name = '数分 1 班'): Promise<{ classId: string; inviteCode: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/teacher/classes',
    headers: auth(cookie),
    payload: { name, term: '2026 秋' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const body = res.json();
  contract.validate('ClassSummary', body);
  expect(body.inviteCode).toMatch(INVITE_PATTERN);
  expect(body.students).toBe(0);
  expect(body.claimed).toBe(0);
  expect(body.settings).toMatchObject({ photoEnabled: true, lessonGenerated: false, revealBudget: 2, testMaxSwitches: 3 });
  return { classId: body.classId as string, inviteCode: body.inviteCode as string };
}

async function importCsv(cookie: string, classId: string, payload: string | Buffer) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/teacher/classes/${classId}/roster`,
    headers: { ...WRITE_HEADERS, cookie, 'content-type': 'text/csv' },
    payload,
  });
}

describe('教师班级与权限（#50）', () => {
  it('未登录 401；学生账号 403', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/teacher/classes' });
    expect(anonymous.statusCode).toBe(401);

    const studentCookie = await studentLogin('K7Q2MX');
    for (const [method, url] of [
      ['GET', '/api/v1/teacher/classes'],
      ['POST', '/api/v1/teacher/classes'],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: auth(studentCookie),
        ...(method === 'POST' ? { payload: { name: 'x', term: 'y' } } : {}),
      });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('建班：ClassSummary + 教师可在 /me.classes 看到；settings 只存白名单默认值', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);

    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie, 'x-pg-app': 'teacher' } });
    expect(me.statusCode).toBe(200);
    expect(me.json().classes.map((c: { id: string }) => c.id)).toContain(classId);

    const row = await db.query<{ settings: Record<string, unknown> }>(
      `select settings from app.classes where id = $1`,
      [classId],
    );
    expect(Object.keys(row.rows[0]?.settings ?? {}).sort()).toEqual([
      'integrityPractice',
      'lessonGenerated',
      'photoEnabled',
      'revealBudget',
      'testMaxSwitches',
    ]);
  });

  it('只返回自己的班级；别的教师的班不可见', async () => {
    const cookie = await teacherLogin();
    const mine = await createClass(cookie);

    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const otherCookie = await teacherLogin('other.teacher');
    const other = await createClass(otherCookie, '别人的班');

    const list = await app.inject({ method: 'GET', url: '/api/v1/teacher/classes', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    const ids = list.json().map((c: { classId: string }) => c.classId);
    expect(ids).toContain(mine.classId);
    expect(ids).not.toContain(other.classId);
  });

  it('重置邀请码：旧码立即失效，已登录学生会话不受影响', async () => {
    const cookie = await teacherLogin();
    const { classId, inviteCode } = await createClass(cookie);
    expect((await importCsv(cookie, classId, '2026001,\n')).statusCode).toBe(200);
    const studentCookie = await studentLogin(inviteCode);

    const rotated = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/classes/${classId}/invite-code`,
      headers: auth(cookie),
    });
    expect(rotated.statusCode, rotated.body).toBe(200);
    const newCode = rotated.json().inviteCode as string;
    expect(newCode).toMatch(INVITE_PATTERN);
    expect(newCode).not.toBe(inviteCode);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/student/login',
      headers: WRITE_HEADERS,
      payload: loginBody({ inviteCode, studentNo: '2026001', deviceId: '0c9d8e7f-6a5b-4c3d-8e2f-1a0b9c8d7e6f' }),
    });
    expect(oldLogin.statusCode).toBe(401);
    expect(oldLogin.json().error.code).toBe('INVALID_INVITE');

    expect((await studentLogin(newCode)).length).toBeGreaterThan(0);
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: studentCookie } });
    expect(me.statusCode).toBe(200);
  });
});

describe('名单 CSV 导入（04 §10）', () => {
  it('UTF-8：新增/重复/非法行；学号只存哈希、姓名加密', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);

    const res = await importCsv(cookie, classId, '2026001,张三\n2026002,李四\n2026002,重复\n,无学号\n');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      added: 2,
      duplicates: 1,
      invalid: [{ row: 4, reason: '学号为空' }],
    });

    const rows = await db.query<{ student_no_hash: string; name_enc: Buffer | null }>(
      `select student_no_hash, name_enc from app.roster_entries where class_id = $1 order by imported_at`,
      [classId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.student_no_hash).toBe(studentNoHash(testConfig.studentNoPepper, '2026001'));
    expect(rows.rows[0]?.name_enc).not.toBeNull();
    expect(decryptPii(testConfig.piiKey, rows.rows[0]?.name_enc as Buffer)).toBe('张三');
  });

  it('GBK：自动识别并正确解码（不依赖 iconv）', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);
    // "2026003,王五" 的 GBK 字节：王=CD F5，五=CE E5
    const gbk = Buffer.from([...Buffer.from('2026003,', 'ascii'), 0xcd, 0xf5, 0xce, 0xe5]);

    const res = await importCsv(cookie, classId, gbk);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ added: 1, duplicates: 0, invalid: [] });

    const row = await db.query<{ name_enc: Buffer }>(
      `select name_enc from app.roster_entries where class_id = $1`,
      [classId],
    );
    expect(decryptPii(testConfig.piiKey, row.rows[0]?.name_enc as Buffer)).toBe('王五');
  });

  it('可选表头；引号内的逗号不切列', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);

    const res = await importCsv(cookie, classId, '学号,姓名\n2026004,"张,三"\n');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ added: 1, duplicates: 0, invalid: [] });
    const row = await db.query<{ name_enc: Buffer }>(
      `select name_enc from app.roster_entries where class_id = $1`,
      [classId],
    );
    expect(decryptPii(testConfig.piiKey, row.rows[0]?.name_enc as Buffer)).toBe('张,三');
  });

  it('超过两列的行报行号与原因', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);
    const res = await importCsv(cookie, classId, '2026005,张,三\n');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().invalid).toEqual([{ row: 1, reason: '列数超过 2 列（学号,姓名）' }]);
  });

  it('重复导入同一份名单：全部计入 duplicates', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);
    await importCsv(cookie, classId, '2026001,张三\n');
    const res = await importCsv(cookie, classId, '2026001,张三\n');
    expect(res.json()).toMatchObject({ added: 0, duplicates: 1 });
  });

  it('空班级名/学期：422', async () => {
    const cookie = await teacherLogin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/classes',
      headers: auth(cookie),
      payload: { name: '   ', term: '2026 秋' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('名单：空文件 422；前置空行后仍能识别表头', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);

    const empty = await importCsv(cookie, classId, '   \n');
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.code).toBe('VALIDATION_FAILED');

    const res = await importCsv(cookie, classId, '\n\n学号,姓名\n2026001,张三\n');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ added: 1, duplicates: 0, invalid: [] });
  });

  it('先导学号后补姓名：重复行会把 name_enc 补上', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);

    expect((await importCsv(cookie, classId, '2026001,\n')).statusCode).toBe(200);
    const res = await importCsv(cookie, classId, '2026001,张三\n');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ added: 0, duplicates: 1 });

    const row = await db.query<{ name_enc: Buffer | null }>(
      `select name_enc from app.roster_entries where class_id = $1`,
      [classId],
    );
    expect(row.rows[0]?.name_enc).not.toBeNull();
    expect(decryptPii(testConfig.piiKey, row.rows[0]?.name_enc as Buffer)).toBe('张三');
  });

  it('归档班级不可再导入名单/重置邀请码（404）', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);
    await db.query(`update app.classes set archived_at = now() where id = $1`, [classId]);

    const roster = await importCsv(cookie, classId, '2026001,张三\n');
    expect(roster.statusCode).toBe(404);
    const invite = await app.inject({
      method: 'POST',
      url: `/api/v1/teacher/classes/${classId}/invite-code`,
      headers: auth(cookie),
    });
    expect(invite.statusCode).toBe(404);
  });

  it('管理员可以看到全部班级（04 §1），但普通教师不行', async () => {
    const cookie = await teacherLogin();
    await createClass(cookie, '教师自己的班');
    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const otherCookie = await teacherLogin('other.teacher');
    await createClass(otherCookie, '别人的班');

    const admin = await db.query<{ id: string }>(
      `insert into app.users (role, anon_code) values ('admin', 'A-ADMIN1') returning id`,
    );
    const adminId = admin.rows[0]?.id as string;
    const all = await listClasses(db, { userId: adminId, role: 'admin', sessionId: 'test' });
    // setupFixture 还建了一个「高数 A 班」，管理员应能看到全部三个班。
    expect(all.map((c) => c.name).sort()).toEqual(['别人的班', '教师自己的班', '高数 A 班'].sort());
  });


  it('PATCH 班级默认设置：白名单合并 + audit；非法枚举 422；非本班 404（#176）', async () => {
    const cookie = await teacherLogin();
    const { classId } = await createClass(cookie);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teacher/classes/${classId}/settings`,
      headers: auth(cookie),
      payload: { photoEnabled: false, revealBudget: 5, integrityPractice: 'log_only', lessonGenerated: true, unknownKey: 'x' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().settings).toMatchObject({
      photoEnabled: false,
      revealBudget: 5,
      integrityPractice: 'log_only',
      lessonGenerated: true,
      testMaxSwitches: 3,
    });
    expect(res.json().settings).not.toHaveProperty('unknownKey');
    const stored = await db.query<{ settings: Record<string, unknown> }>(`select settings from app.classes where id = $1`, [classId]);
    expect(stored.rows[0]?.settings).toMatchObject({ photoEnabled: false, revealBudget: 5 });
    const audit = await db.query(`select action from app.audit_log where action = 'update_class_settings' and target = $1`, [classId]);
    expect(audit.rows).toHaveLength(1);

    // PATCH 语义：只改传入的键，之前保存的 revealBudget/photoEnabled 不能被重置回默认值。
    const partial = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teacher/classes/${classId}/settings`,
      headers: auth(cookie),
      payload: { testMaxSwitches: 5 },
    });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(partial.json().settings).toMatchObject({ testMaxSwitches: 5, revealBudget: 5, photoEnabled: false, lessonGenerated: true });

    for (const payload of [{ integrityPractice: 'nope' }, { revealBudget: -1 }, { revealBudget: 99 }, { testMaxSwitches: -1 }]) {
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/v1/teacher/classes/${classId}/settings`,
        headers: auth(cookie),
        payload,
      });
      expect(invalid.statusCode, invalid.body).toBe(422);
    }

    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const other = await teacherLogin('other.teacher');
    const hidden = await app.inject({
      method: 'PATCH',
      url: `/api/v1/teacher/classes/${classId}/settings`,
      headers: auth(other),
      payload: { photoEnabled: true },
    });
    expect(hidden.statusCode, hidden.body).toBe(404);
  });

  it('名单列表：姓名/认领状态；解除认领写审计；非本班 404（#167）', async () => {
    const cookie = await teacherLogin();
    const { classId, inviteCode } = await createClass(cookie);
    const imported = await importCsv(cookie, classId, '2026001,张三\n2026002,\n');
    expect(imported.statusCode, imported.body).toBe(200);

    const before = await app.inject({ method: 'GET', url: `/api/v1/teacher/classes/${classId}/roster`, headers: auth(cookie) });
    expect(before.statusCode, before.body).toBe(200);
    const entries = before.json() as Array<{ rosterId: string; name: string | null; claimed: boolean; claimedByAnon: string | null }>;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.name)).toContain('张三');
    expect(entries.map((entry) => entry.name)).toContain(null);
    expect(entries.every((entry) => !entry.claimed)).toBe(true);
    const raw = entries[0] as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('studentNo');
    expect(raw).not.toHaveProperty('student_no_hash');

    await studentLogin(inviteCode, '2026001');
    const afterLogin = await app.inject({ method: 'GET', url: `/api/v1/teacher/classes/${classId}/roster`, headers: auth(cookie) });
    const claimedEntry = (afterLogin.json() as Array<{ rosterId: string; claimed: boolean; claimedByAnon: string | null }>).find(
      (entry) => entry.claimed,
    );
    expect(claimedEntry).toBeTruthy();
    expect(claimedEntry?.claimedByAnon).toMatch(/^S-/);
    expect(String((claimedEntry as unknown as { claimedAt?: string }).claimedAt)).toMatch(/Z$/);

    const unclaimed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/teacher/classes/${classId}/roster/${claimedEntry?.rosterId}`,
      headers: auth(cookie),
    });
    expect(unclaimed.statusCode, unclaimed.body).toBe(204);
    const afterUnclaim = await app.inject({ method: 'GET', url: `/api/v1/teacher/classes/${classId}/roster`, headers: auth(cookie) });
    expect((afterUnclaim.json() as Array<{ claimed: boolean }>).every((entry) => !entry.claimed)).toBe(true);
    const again = await app.inject({
      method: 'DELETE',
      url: `/api/v1/teacher/classes/${classId}/roster/${claimedEntry?.rosterId}`,
      headers: auth(cookie),
    });
    expect(again.statusCode, again.body).toBe(404);
    const audit = await db.query<{ detail: { unclaimedAnon?: string } }>(
      `select detail from app.audit_log where action = 'unclaim_roster' and target = $1`,
      [claimedEntry?.rosterId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.detail.unclaimedAnon).toMatch(/^S-/);

    await createTeacherAccount(db, { username: 'other.teacher', password: PASSWORD });
    const other = await teacherLogin('other.teacher');
    const hidden = await app.inject({ method: 'GET', url: `/api/v1/teacher/classes/${classId}/roster`, headers: auth(other) });
    expect(hidden.statusCode, hidden.body).toBe(404);
  });
});
