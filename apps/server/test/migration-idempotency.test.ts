import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applySchema, migrate, openDb, type Db } from '../src/db/index.ts';
import { MIGRATIONS_DIR } from '../src/db/migrate.ts';

let db: Db;

beforeEach(async () => {
  db = await openDb({ pgliteDir: 'memory' });
});
afterEach(async () => {
  await db.close();
});

const hasTable = async (name: string) =>
  (await db.query<{ t: string | null }>('select to_regclass($1)::text as t', [name])).rows[0]?.t !== null;

describe('0001 迁移（07 §8）', () => {
  it('旧库（由旧 schema.sql 建成、没有版本表）重跑 migrate 会补上 app.idempotency_keys', async () => {
    // 模拟按旧 schema 建成的库：最新 schema 里已有这张表，先删掉，再删版本表。
    await applySchema(db);
    await db.exec('drop table if exists public.schema_migrations');
    await db.exec('drop table if exists app.idempotency_keys');
    expect(await hasTable('app.idempotency_keys')).toBe(false);

    const result = await migrate(db);
    expect(result.baselined).toBe(true);
    // 旧库缺的不止一张表：schema.sql 是最新全量，这里只删了 idempotency_keys，其余迁移都是 IF NOT EXISTS，重跑无害。
    expect(result.applied).toEqual(['0001_idempotency_keys.sql', '0006_course_path.sql']);
    expect(await hasTable('app.idempotency_keys')).toBe(true);

    const rows = (
      await db.query<{ version: string; sha256: string | null }>(
        'select version, sha256 from public.schema_migrations order by version',
      )
    ).rows;
    expect(rows.map((row) => row.version)).toEqual(['0000_init', '0001_idempotency_keys.sql', '0006_course_path.sql']);
    expect(rows[1]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('0006：按旧结构建成的库迁移后有路径表、origin/review_source/hidden_at 列与自学布置唯一索引，且可重复执行', async () => {
    await applySchema(db);
    await db.exec('drop table if exists public.schema_migrations');
    await db.exec('drop table app.solution_reveals');
    await db.exec('drop table content.unit_items');
    await db.exec('drop table content.course_units');
    await db.exec('drop table content.courses');
    await db.exec('drop index app.assignments_one_path');
    await db.exec('alter table app.assignments drop column origin');
    await db.exec('alter table content.problem_versions drop column review_source');
    await db.exec('alter table content.problems drop column hidden_at');

    await migrate(db);
    for (const table of ['content.courses', 'content.course_units', 'content.unit_items', 'app.solution_reveals']) {
      expect(await hasTable(table), table).toBe(true);
    }
    const cols = (
      await db.query<{ c: string }>(
        `select table_schema || '.' || table_name || '.' || column_name as c from information_schema.columns
          where column_name in ('origin', 'review_source', 'hidden_at')`,
      )
    ).rows.map((row) => row.c);
    expect(cols).toEqual(
      expect.arrayContaining(['app.assignments.origin', 'content.problem_versions.review_source', 'content.problems.hidden_at']),
    );
    const idx = await db.query(`select 1 from pg_indexes where indexname = 'assignments_one_path'`);
    expect(idx.rows).toHaveLength(1);

    // 再执行一遍迁移 SQL 本身不报错（IF NOT EXISTS / 重复约束吞掉）。
    const sql = readFileSync(`${MIGRATIONS_DIR}/0006_course_path.sql`, 'utf8');
    await db.exec(sql);
  });

  it('迁移文件创建的表/列在 schema.sql 中存在（防止只加迁移、忘了同步 schema.sql）', () => {
    const schema = readFileSync(fileURLToPath(import.meta.resolve('@proof-gym/contracts/schema.sql')), 'utf8').toLowerCase();
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const sql = readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8').toLowerCase();
      for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+\.[a-z_]+)/g)) {
        expect(schema, `${file}: schema.sql 缺少表 ${match[1]}`).toContain(`create table ${match[1]}`);
      }
      for (const match of sql.matchAll(/alter\s+table\s+([a-z_]+\.[a-z_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_]+)/g)) {
        expect(schema, `${file}: schema.sql 缺少列 ${match[1]}.${match[2]}`).toContain(match[2]);
      }
    }
  });
});
