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
    // 旧库没有版本表：只记基线 0000_init，再把 migrations/ 里的文件全部（幂等地）执行一遍。
    expect(result.applied).toEqual(['0001_idempotency_keys.sql', '0002_student_password.sql']);
    expect(await hasTable('app.idempotency_keys')).toBe(true);

    const rows = (
      await db.query<{ version: string; sha256: string | null }>(
        'select version, sha256 from public.schema_migrations order by version',
      )
    ).rows;
    expect(rows.map((row) => row.version)).toEqual(['0000_init', '0001_idempotency_keys.sql', '0002_student_password.sql']);
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
