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
    // 其它迁移（0004 …）也会补上；这里只关心 0001 在其中。
    expect(result.applied).toContain('0001_idempotency_keys.sql');
    expect(await hasTable('app.idempotency_keys')).toBe(true);

    const rows = (
      await db.query<{ version: string; sha256: string | null }>(
        'select version, sha256 from public.schema_migrations order by version',
      )
    ).rows;
    expect(rows.map((row) => row.version)).toEqual(['0000_init', ...result.applied]);
    expect(rows[1]?.sha256).toMatch(/^[0-9a-f]{64}$/);
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

describe('0004 迁移（求助落库）', () => {
  it('旧库缺索引和 annotations 新列时，migrate 补上；重复执行不报错', async () => {
    await applySchema(db);
    await db.exec('drop table if exists public.schema_migrations');
    await db.exec('drop index if exists app.hint_deliveries_attempt');
    await db.exec('drop index if exists app.annotations_attempt');
    await db.exec('alter table app.annotations drop column help_id, drop column ai_generated, drop column useful');

    const result = await migrate(db);
    expect(result.applied).toContain('0004_help_notes.sql');
    const cols = (
      await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'app' and table_name = 'annotations'`,
      )
    ).rows.map((row) => row.column_name);
    expect(cols).toEqual(expect.arrayContaining(['help_id', 'ai_generated', 'useful']));
    const idx = (await db.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'app'`)).rows.map((row) => row.indexname);
    expect(idx).toEqual(expect.arrayContaining(['hint_deliveries_attempt', 'annotations_attempt']));

    const again = await migrate(db);
    expect(again.applied).toEqual([]);
  });
});
