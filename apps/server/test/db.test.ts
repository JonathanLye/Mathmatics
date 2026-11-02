import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applySchema, openDb, seedContent, type Db } from '../src/db/index.ts';

let db: Db;

beforeAll(async () => {
  db = await openDb({ pgliteDir: 'memory' });
  await applySchema(db);
  await seedContent(db);
});

afterAll(async () => {
  await db.close();
});

describe('数据库与 seed', () => {
  it('导入 4 道题', async () => {
    const result = await db.query<{ count: number }>(
      'select count(*)::int as count from content.problem_versions',
    );
    expect(result.rows[0]?.count).toBe(4);
  });

  it('已发布的题目公开部分、秘密部分与参考证明都入库', async () => {
    const row = await db.query<{ public: { title: string }; review_status: string }>(
      `select pv.public, pv.review_status from content.problem_versions pv where pv.problem_id = 'epsN' and pv.version = 1`,
    );
    expect(row.rows[0]?.review_status).toBe('published');
    expect(row.rows[0]?.public.title).toContain('ε');
  });

  it('概念库与术语词条入库', async () => {
    const concepts = await db.query<{ count: number }>(
      'select count(*)::int as count from content.concepts',
    );
    const glossary = await db.query<{ count: number }>(
      'select count(*)::int as count from content.glossary',
    );
    expect(concepts.rows[0]?.count).toBeGreaterThan(0);
    expect(glossary.rows[0]?.count).toBeGreaterThan(0);
  });
});
