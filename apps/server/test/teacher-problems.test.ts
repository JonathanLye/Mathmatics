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

  it('POST review：approve 要求四项 S8 全绿并发布；return 记退回；edit 未实现 422', async () => {
    const seedPkg = (await db.query<{ public: unknown }>(`select public from content.problem_versions where problem_id='epsN' and version=1`)).rows[0];
    const insertDraft = async (version: number, checks: Record<string, boolean>) => {
      await db.query(
        `insert into content.problem_versions (problem_id, version, public, review_status, auto_checks, provenance)
         values ('epsN', $1, $2::jsonb, 'draft', $3::jsonb, '{}'::jsonb)`,
        [version, JSON.stringify(seedPkg?.public), JSON.stringify(checks)],
      );
    };
    const allGreen = { schema: true, katex: true, leakExhaustive: true, patternSelfTest: true };

    // 缺校验项 → 422
    await insertDraft(2, { schema: true });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/problems/epsN/versions/2/review',
      headers: { ...WRITE_HEADERS, cookie },
      payload: { decision: 'approve' },
    });
    expect(bad.statusCode, bad.body).toBe(422);

    // 补齐全绿 → approve 发布并切 current_version
    await db.query(`update content.problem_versions set auto_checks = $1::jsonb where problem_id='epsN' and version=2`, [
      JSON.stringify(allGreen),
    ]);
    const approved = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/problems/epsN/versions/2/review',
      headers: { ...WRITE_HEADERS, cookie },
      payload: { decision: 'approve', comments: 'ok', minutes: 12 },
    });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ problemId: 'epsN', version: 2, status: 'published' });
    const listed = await db.query(`select current_version from content.problems where id='epsN'`);
    expect(Number(listed.rows[0]?.current_version)).toBe(2);
    const records = await db.query(`select decision, minutes_spent from content.review_records where problem_id='epsN' and version=2`);
    expect(records.rows[0]).toMatchObject({ decision: 'approve', minutes_spent: 12 });

    // return 记录退回
    await insertDraft(3, allGreen);
    const returned = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/problems/epsN/versions/3/review',
      headers: { ...WRITE_HEADERS, cookie },
      payload: { decision: 'return', comments: '缺定义' },
    });
    expect(returned.statusCode, returned.body).toBe(200);
    expect(returned.json().status).toBe('returned');

    const edit = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/problems/epsN/versions/3/review',
      headers: { ...WRITE_HEADERS, cookie },
      payload: { decision: 'edit', edited: {} },
    });
    expect(edit.statusCode).toBe(422);
  });

  it('POST review edit：服务端重跑 S8 全绿后发布为新版本；失败 422', async () => {
    const current = await app.inject({ method: 'GET', url: '/api/v1/teacher/problems/epsN/versions/1', headers: { cookie } });
    expect(current.statusCode, current.body).toBe(200);
    const pkg = current.json() as Record<string, unknown> & { public: Record<string, unknown>; secret: Record<string, unknown> };
    pkg.public.title = '数列极限 · ε-N（教师修改）';

    const edited = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/problems/epsN/versions/1/review',
      headers: { ...WRITE_HEADERS, cookie },
      payload: { decision: 'edit', edited: pkg, comments: '改标题', minutes: 5 },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    const item = edited.json() as { version: number; status: string; title: string };
    expect(item.version).toBe(2);
    expect(item.status).toBe('published');
    expect(item.title).toContain('教师修改');
    const problems = await db.query(`select current_version from content.problems where id='epsN'`);
    expect(Number(problems.rows[0]?.current_version)).toBe(2);
    const record = await db.query(`select decision from content.review_records where problem_id='epsN' and version=2`);
    expect(record.rows[0]?.decision).toBe('edit');
    const secret = await db.query(`select 1 from vault.problem_secrets where problem_id='epsN' and version=2`);
    expect(secret.rows.length).toBe(1);

    // 结构不合法 → 422，不写新版本
    const bad = structuredClone(pkg);
    (bad.public as Record<string, unknown>).keyCount = Number((bad.public as Record<string, unknown>).keyCount) + 1;
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/teacher/problems/epsN/versions/1/review',
      headers: { ...WRITE_HEADERS, cookie },
      payload: { decision: 'edit', edited: bad },
    });
    expect(rejected.statusCode, rejected.body).toBe(422);
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
