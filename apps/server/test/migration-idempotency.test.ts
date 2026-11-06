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

const migrationFiles = (): string[] => readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

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
    // 旧库会执行 migrations/ 里全部文件（每个迁移都必须能在「已含最新结构」的库上重复执行）。
    expect(result.applied).toEqual(migrationFiles());
    expect(await hasTable('app.idempotency_keys')).toBe(true);

    const rows = (
      await db.query<{ version: string; sha256: string | null }>(
        'select version, sha256 from public.schema_migrations order by version',
      )
    ).rows;
    expect(rows.map((row) => row.version)).toEqual(['0000_init', ...migrationFiles()]);
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

describe('0003 重做迁移（attempts.kind 放宽为 main|transfer|redo）', () => {
  it('旧库（CHECK 只允许 main|transfer、没有 redo 唯一索引）迁移后可以写入 kind=redo，且同一父作答只能有一个未结束的重做', async () => {
    await applySchema(db);
    await db.exec('drop table if exists public.schema_migrations');
    await db.exec('alter table app.attempts drop constraint attempts_kind_check');
    await db.exec(`alter table app.attempts add constraint attempts_kind_check check (kind in ('main', 'transfer'))`);
    await db.exec('drop index app.attempts_one_open_redo');

    await migrate(db);
    await migrate(db); // 重复执行无副作用

    const seeded = await seedAttempt();
    const insertRedo = (status: string) =>
      db.query(
        `insert into app.attempts (assignment_id, user_id, problem_id, problem_version, kind, parent_attempt_id, mode, state, keys_total, status)
         values ($1, $2, 'p1', 1, 'redo', $3, 'practice', '{}'::jsonb, 1, $4)`,
        [seeded.assignmentId, seeded.userId, seeded.attemptId, status],
      );
    await insertRedo('active');
    await expect(insertRedo('parked')).rejects.toThrow();
    await db.query(`update app.attempts set status = 'completed' where kind = 'redo'`);
    await insertRedo('active'); // 上一个重做结束后可以再开一个
    await expect(
      db.query(`update app.attempts set kind = 'bogus' where id = $1`, [seeded.attemptId]),
    ).rejects.toThrow();
  });

  async function seedAttempt(): Promise<{ assignmentId: string; userId: string; attemptId: string }> {
    const user = (await db.query<{ id: string }>(`insert into app.users (role, anon_code) values ('student', 'S-MIG001') returning id`)).rows[0]?.id as string;
    const teacher = (await db.query<{ id: string }>(`insert into app.users (role, anon_code) values ('teacher', 'T-MIG001') returning id`)).rows[0]?.id as string;
    const cls = (await db.query<{ id: string }>(`insert into app.classes (name, term, owner_id, invite_code) values ('c', 't', $1, 'MIGCODE') returning id`, [teacher])).rows[0]?.id as string;
    await db.query(`insert into content.problems (id, kind, title, current_version) values ('p1', 'main', 'p', 1)`);
    await db.query(`insert into content.problem_versions (problem_id, version, public, review_status) values ('p1', 1, '{}'::jsonb, 'published')`);
    const asg = (
      await db.query<{ id: string }>(
        `insert into app.assignments (class_id, problem_id, problem_version, mode, open_at, status, created_by)
         values ($1, 'p1', 1, 'practice', now(), 'open', $2) returning id`,
        [cls, teacher],
      )
    ).rows[0]?.id as string;
    const attempt = (
      await db.query<{ id: string }>(
        `insert into app.attempts (assignment_id, user_id, problem_id, problem_version, kind, mode, state, keys_total, status)
         values ($1, $2, 'p1', 1, 'main', 'practice', '{}'::jsonb, 1, 'completed') returning id`,
        [asg, user],
      )
    ).rows[0]?.id as string;
    return { assignmentId: asg, userId: user, attemptId: attempt };
  }
});
