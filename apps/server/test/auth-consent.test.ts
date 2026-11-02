import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requireStudentConsent } from '../src/auth/consent.ts';
import { createSession, SESSION_COOKIE, STUDENT_SESSION_MS } from '../src/auth/session.ts';
import { loadContract } from '../src/contract.ts';
import type { Db } from '../src/db/index.ts';

import {
  buildTestApp,
  cookieFrom,
  DEVICE_A,
  loginBody,
  setupFixture,
  WRITE_HEADERS,
  type Fixture,
} from './support/fixtures.ts';

const contract = loadContract();

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

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  app = await buildTestApp(db);
  // 探针：挂上与作答接口相同的守卫（作答接口在 #19 挂载）。
  app.get('/api/v1/probe/attempt', { preHandler: requireStudentConsent(db) }, async () => ({ ok: true }));
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

async function studentCookie(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/student/login',
    headers: WRITE_HEADERS,
    payload: loginBody(),
  });
  return cookieFrom(res.headers['set-cookie']);
}

async function teacherCookie(): Promise<string> {
  const teacher = await db.query<{ id: string }>(`select id from app.users where role = 'teacher'`);
  const userId = teacher.rows[0]?.id as string;
  await db.query(`insert into app.devices (id, user_id) values ($1, $2)`, [DEVICE_A, userId]);
  const session = await createSession(db, {
    userId,
    deviceId: DEVICE_A,
    ip: null,
    ttlMs: STUDENT_SESSION_MS,
  });
  return `${SESSION_COOKIE}=${app.signCookie(session.id)}`;
}

function signConsent(cookie: string, body: Record<string, unknown> = { version: 'p0-v1', items: ALL_REQUIRED }, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/consents',
    headers: { cookie, ...WRITE_HEADERS, ...headers },
    payload: body,
  });
}

describe('知情同意书接口', () => {
  it('GET /consents 返回当前版本、五段文案，且尚未签署', async () => {
    const cookie = await studentCookie();

    const res = await app.inject({ method: 'GET', url: '/api/v1/consents', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const doc = res.json();
    contract.validate('ConsentDoc', doc);
    expect(doc.version).toBe('p0-v1');
    expect(doc.sections.map((s: { key: string }) => s.key)).toEqual([
      'service',
      'crossBorderHosting',
      'crossBorderModel',
      'monitoring',
      'research',
    ]);
    expect(doc.sections.filter((s: { required: boolean }) => s.required).map((s: { key: string }) => s.key)).toEqual([
      'service',
      'crossBorderHosting',
      'monitoring',
    ]);
    expect(doc.signed).toBeNull();
  });

  it('未登录：GET 与 POST 都是 401', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/v1/consents' });
    const post = await signConsent('');

    expect(get.statusCode).toBe(401);
    expect(post.statusCode).toBe(401);
  });

  it('必选项未勾选：422 并列出缺失项，不写库', async () => {
    const cookie = await studentCookie();

    const res = await signConsent(cookie, {
      version: 'p0-v1',
      items: { ...ALL_REQUIRED, crossBorderHosting: false },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION_FAILED', detail: { missing: ['crossBorderHosting'] } });
    const rows = await db.query<{ n: number }>('select count(*)::int as n from app.consents');
    expect(rows.rows[0]?.n).toBe(0);
  });

  it('版本号不是当前版本：422，并给出 currentVersion', async () => {
    const cookie = await studentCookie();

    const res = await signConsent(cookie, { version: 'p0-v0', items: ALL_REQUIRED });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.detail).toEqual({ currentVersion: 'p0-v1' });
  });

  it('必选项全部勾选：返回 consentRequired=false，记录 IP /24 掩码与 UA 哈希', async () => {
    const cookie = await studentCookie();

    const res = await signConsent(cookie, { version: 'p0-v1', items: ALL_REQUIRED }, { 'user-agent': 'test-agent/1.0' });

    expect(res.statusCode).toBe(200);
    contract.validate('Me', res.json());
    expect(res.json().consentRequired).toBe(false);

    const row = await db.query<{ ip_masked: string; ua_hash: string; version: string }>(
      'select ip_masked, ua_hash, version from app.consents',
    );
    expect(row.rows[0]).toMatchObject({ ip_masked: '127.0.0.0/24', version: 'p0-v1' });
    expect(row.rows[0]?.ua_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('签署后 GET /consents 的 signed 记录本次选择（不勾选的可选项为 false）', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);

    const res = await app.inject({ method: 'GET', url: '/api/v1/consents', headers: { cookie } });

    expect(res.json().signed).toMatchObject({ version: 'p0-v1', items: ALL_REQUIRED });
    contract.validate('ConsentDoc', res.json());
  });

  it('教师不能签署：403 FORBIDDEN', async () => {
    const res = await signConsent(await teacherCookie());

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe('同意书守卫（作答接口挂载点）', () => {
  it('未登录：401 UNAUTHORIZED', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/attempt' });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('已登录但未签同意书：403 CONSENT_REQUIRED', async () => {
    const cookie = await studentCookie();

    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/attempt', headers: { cookie } });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('签署后放行', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);

    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/attempt', headers: { cookie } });

    expect(res.statusCode).toBe(200);
  });

  it('撤回签署后再次拦截', async () => {
    const cookie = await studentCookie();
    await signConsent(cookie);
    await db.query('update app.consents set revoked_at = now()');

    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/attempt', headers: { cookie } });

    expect(res.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('旧版本的签署不满足当前版本：仍需重签', async () => {
    const cookie = await studentCookie();
    const student = await db.query<{ user_id: string }>('select user_id from app.student_profiles');
    await db.query(
      `insert into app.consents (user_id, version, items) values ($1, 'p0-v0', $2::jsonb)`,
      [student.rows[0]?.user_id, JSON.stringify(ALL_REQUIRED)],
    );

    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/attempt', headers: { cookie } });

    expect(res.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('教师访问学生守卫的接口：403 FORBIDDEN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/probe/attempt',
      headers: { cookie: await teacherCookie() },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});
