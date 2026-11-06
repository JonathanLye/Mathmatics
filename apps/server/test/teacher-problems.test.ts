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

  it('POST review：approve 要求四项 S8 全绿并发布；return 记退回；edit 空包 422', async () => {
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

    // 审核记录回读（#159）：reviewer / reviewedAt / comments 随题目包返回。
    await db.query(
      `insert into vault.problem_secrets (problem_id, version, secret)
       select 'epsN', 2, secret from vault.problem_secrets where problem_id='epsN' and version=1`,
    );
    const detail = await app.inject({ method: 'GET', url: '/api/v1/teacher/problems/epsN/versions/2', headers: { cookie } });
    expect(detail.statusCode, detail.body).toBe(200);
    const review = (detail.json() as { review: { reviewer?: string; reviewedAt?: string; comments?: string } }).review;
    expect(review.reviewer).toBeTruthy();
    expect(review.reviewedAt).toBeTruthy();
    expect(review.comments).toBe('ok');

    // #178：列表返回最近审核人/时间（04 §8.1）。
    const listAfter = await app.inject({ method: 'GET', url: '/api/v1/teacher/problems?status=published', headers: { cookie } });
    const row = (listAfter.json() as Array<{ problemId: string; version: number; reviewedBy?: string; reviewedAt?: string }>).find(
      (item) => item.problemId === 'epsN' && item.version === 2,
    );
    expect(row?.reviewedBy).toBeTruthy();
    expect(row?.reviewedAt).toMatch(/Z$/);

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
  it('审核来源与类型筛选（reviewSource / kind），非法值 422；分页时筛选仍稳定', async () => {
    await db.query(`update content.problem_versions set review_source = 'auto' where problem_id = 'series' and version = 1`);
    const list = async (query: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/teacher/problems?${query}`, headers: { cookie } });
      expect(res.statusCode, res.body).toBe(200);
      return res;
    };
    const autoOnly = (await list('reviewSource=auto')).json() as Array<{ problemId: string; reviewSource: string }>;
    expect(autoOnly.map((item) => item.problemId)).toEqual(['series']);
    const teacherOnly = (await list('reviewSource=teacher')).json() as Array<{ problemId: string; reviewSource: string }>;
    expect(teacherOnly.length).toBeGreaterThan(0);
    expect(teacherOnly.every((item) => item.reviewSource === 'teacher' && item.problemId !== 'series')).toBe(true);
    const mains = (await list('kind=main')).json() as Array<{ kind: string }>;
    expect(mains.length).toBeGreaterThan(0);
    expect(mains.every((item) => item.kind === 'main')).toBe(true);
    const page = await list('kind=main&limit=1');
    expect((page.json() as unknown[]).length).toBe(1);
    expect(page.headers['x-next-cursor']).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/api/v1/teacher/problems?reviewSource=x', headers: { cookie } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/api/v1/teacher/problems?kind=x', headers: { cookie } })).statusCode).toBe(422);
  });

  it('PATCH visibility：下架写 hidden_at 与审计，列表带 hiddenAt；恢复后清除；不存在 404；非布尔 422', async () => {
    const patch = (problemId: string, payload: unknown, withCookie = true) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/teacher/problems/${problemId}/visibility`,
        headers: withCookie ? { ...WRITE_HEADERS, cookie } : WRITE_HEADERS,
        payload: payload as object,
      });
    const hidden = await patch('epsN', { hidden: true });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(hidden.json()).toMatchObject({ problemId: 'epsN' });
    expect(hidden.json().hiddenAt).toMatch(/Z$/);
    const row = (await db.query<{ hidden_at: string | null }>(`select hidden_at::text as hidden_at from content.problems where id = 'epsN'`)).rows[0];
    expect(row?.hidden_at).not.toBeNull();
    expect((await db.query(`select 1 from app.audit_log where action = 'hide_problem' and target = 'epsN'`)).rows.length).toBe(1);

    const items = (await app.inject({ method: 'GET', url: '/api/v1/teacher/problems', headers: { cookie } })).json() as Array<{ problemId: string; hiddenAt?: string }>;
    expect(items.find((item) => item.problemId === 'epsN')?.hiddenAt).toMatch(/Z$/);
    expect(items.find((item) => item.problemId === 'series')?.hiddenAt).toBeUndefined();
    // 再下架一次是幂等的：时间不变
    const again = await patch('epsN', { hidden: true });
    expect(again.json().hiddenAt).toBe(hidden.json().hiddenAt);

    const restored = await patch('epsN', { hidden: false });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toEqual({ problemId: 'epsN', hiddenAt: null });
    expect((await db.query(`select 1 from app.audit_log where action = 'unhide_problem' and target = 'epsN'`)).rows.length).toBe(1);

    expect((await patch('nope', { hidden: true })).statusCode).toBe(404);
    expect((await patch('epsN', { hidden: 'yes' })).statusCode).toBe(422);
    expect((await patch('epsN', {}, false)).statusCode).toBe(401);
  });
});
