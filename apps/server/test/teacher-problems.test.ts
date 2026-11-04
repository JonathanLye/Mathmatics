import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';
import { seedContent } from '../src/db/seed.ts';

import { buildTestApp, cookieFrom, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

import type { FastifyInstance } from 'fastify';

const USERNAME = 'problems.teacher';
const PASSWORD = 'correct horse battery';

let fx: Fixture;
let db: Db;
let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  await seedContent(db);
  app = await buildTestApp(db);
  await createTeacherAccount(db, { username: USERNAME, password: PASSWORD });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/teacher/login',
    headers: WRITE_HEADERS,
    payload: { username: USERNAME, password: PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  cookie = cookieFrom(res.headers['set-cookie']);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

describe('审核屏只读接口（#42 / 04 §8）', () => {
  it('GET /teacher/problems：列表字段通过 ProblemListItem 契约', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/teacher/problems', headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json() as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (const item of items) {
      const { loadContract } = await import('../src/contract.ts');
      loadContract().validate('ProblemListItem', item);
    }
    const eps = items.find((item) => item.problemId === 'epsN');
    expect(eps).toMatchObject({ version: 1, status: 'published', kind: 'main' });
    expect(eps?.autoChecks).toBeDefined();

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/teacher/problems?chapter=${encodeURIComponent('第二章 数列极限')}`,
      headers: { cookie },
    });
    expect(filtered.statusCode).toBe(200);
    for (const item of filtered.json() as Array<Record<string, unknown>>) expect(item.chapter).toBe('第二章 数列极限');

    const bad = await app.inject({ method: 'GET', url: '/api/v1/teacher/problems?status=nope', headers: { cookie } });
    expect(bad.statusCode).toBe(422);
  });

  it('GET 完整题目包：含 secret，读操作写 audit_log；404/422', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/teacher/problems/epsN/versions/1', headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    const pkg = res.json() as { id: string; version: number; public: unknown; secret: { keys: unknown[] }; review: { status: string } };
    expect(pkg.id).toBe('epsN');
    expect(pkg.version).toBe(1);
    expect(pkg.public).toBeDefined();
    expect(pkg.secret.keys.length).toBeGreaterThan(0);
    expect(pkg.review.status).toBe('published');

    const audit = await db.query(`select 1 from app.audit_log where action = 'read_problem' and target = 'epsN@v1'`);
    expect(audit.rows.length).toBe(1);

    expect((await app.inject({ method: 'GET', url: '/api/v1/teacher/problems/epsN/versions/99', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/teacher/problems/epsN/versions/abc', headers: { cookie } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/api/v1/teacher/problems' })).statusCode).toBe(401);
  });
});
