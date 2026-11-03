import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applySchema, migrate, openDb, type Db } from '../src/db/index.ts';

let db: Db;
let dir: string;

beforeEach(async () => {
  db = await openDb({ pgliteDir: 'memory' });
  dir = mkdtempSync(join(tmpdir(), 'pg-migrations-'));
});
afterEach(async () => {
  await db.close();
});

const write = (name: string, sql: string) => writeFileSync(join(dir, name), sql);
const versions = async () => (await db.query<{ version: string }>('select version from public.schema_migrations order by version')).rows.map((r) => r.version);
const hashes = async () =>
  Object.fromEntries(
    (
      await db.query<{ version: string; sha256: string | null }>(
        'select version, sha256 from public.schema_migrations order by version',
      )
    ).rows.map((r) => [r.version, r.sha256] as const),
  );
const hasTable = async (name: string) => (await db.query<{ t: string | null }>('select to_regclass($1)::text as t', [name])).rows[0]?.t !== null;

describe('版本化迁移（07 §8）', () => {
  it('新库：执行 schema.sql，已有的迁移文件记为已应用但不执行', async () => {
    write('0001_would_fail_if_run.sql', 'select 1/0;');
    const result = await migrate(db, { migrationsDir: dir });

    expect(result).toEqual({ initialized: true, baselined: false, applied: [] });
    expect(await hasTable('app.users')).toBe(true);
    expect(await versions()).toEqual(['0000_init', '0001_would_fail_if_run.sql']);
  });

  it('连续执行两次都成功，第二次什么也不做（复审 P1-0 的复现）', async () => {
    await migrate(db, { migrationsDir: dir });
    const again = await migrate(db, { migrationsDir: dir });

    expect(again).toEqual({ initialized: false, baselined: false, applied: [] });
    expect(await versions()).toEqual(['0000_init']);
  });

  it('已初始化后新增的迁移文件只执行一次', async () => {
    await migrate(db, { migrationsDir: dir });
    write('0001_add_note.sql', 'create table app.migration_probe (id int primary key); insert into app.migration_probe values (1);');

    expect((await migrate(db, { migrationsDir: dir })).applied).toEqual(['0001_add_note.sql']);
    expect((await migrate(db, { migrationsDir: dir })).applied).toEqual([]);
    expect(await hasTable('app.migration_probe')).toBe(true);
    expect(await versions()).toEqual(['0000_init', '0001_add_note.sql']);
  });

  it('旧库（旧版 db:migrate 建成，没有版本表）：只记基线，不重复建表，并执行全部迁移文件', async () => {
    await applySchema(db);
    write('0001_add_probe.sql', 'create table if not exists app.legacy_probe (id int primary key);');

    const result = await migrate(db, { migrationsDir: dir });

    expect(result).toEqual({ initialized: false, baselined: true, applied: ['0001_add_probe.sql'] });
    expect(await hasTable('app.legacy_probe')).toBe(true);
    expect(await versions()).toEqual(['0000_init', '0001_add_probe.sql']);
  });

  it('迁移失败：整个事务回滚，不记录，修好后可以重试', async () => {
    await migrate(db, { migrationsDir: dir });
    write('0001_broken.sql', 'create table app.half_done (id int); select 1/0;');

    await expect(migrate(db, { migrationsDir: dir })).rejects.toThrow();
    expect(await hasTable('app.half_done')).toBe(false);
    expect(await versions()).toEqual(['0000_init']);

    write('0001_broken.sql', 'create table app.half_done (id int);');
    expect((await migrate(db, { migrationsDir: dir })).applied).toEqual(['0001_broken.sql']);
  });

  it('按文件名顺序执行', async () => {
    await migrate(db, { migrationsDir: dir });
    write('0002_second.sql', 'insert into app.order_probe values (2);');
    write('0001_first.sql', 'create table app.order_probe (n int); insert into app.order_probe values (1);');

    expect((await migrate(db, { migrationsDir: dir })).applied).toEqual(['0001_first.sql', '0002_second.sql']);
    const rows = (await db.query<{ n: number }>('select n from app.order_probe order by n')).rows.map((r) => r.n);
    expect(rows).toEqual([1, 2]);
  });

  it('文件名不合法（含保留的 0000）直接报错，不执行任何东西', async () => {
    mkdirSync(join(dir, 'sub'));
    write('add_column.sql', 'select 1;');
    await expect(migrate(db, { migrationsDir: dir })).rejects.toThrow('迁移文件名不合法');
    expect(await hasTable('app.users')).toBe(false);
  });

  it('新库把已有迁移的 sha256 记下来；已记录文件被改后拒绝执行', async () => {
    write('0001_probe.sql', 'create table app.probe_hash (id int);');
    await migrate(db, { migrationsDir: dir });
    const before = await hashes();
    expect(before['0001_probe.sql']).toMatch(/^[0-9a-f]{64}$/);
    expect(before['0000_init']).toBeNull();

    write('0001_probe.sql', 'create table app.probe_hash (id int, extra int);');
    await expect(migrate(db, { migrationsDir: dir })).rejects.toThrow('迁移文件已被修改');
  });

  it('旧版版本表没有 sha256：第一次遇到补写 hash，不改已执行的文件', async () => {
    await migrate(db, { migrationsDir: dir });
    write('0001_probe.sql', 'create table app.probe_legacy (id int);');
    expect((await migrate(db, { migrationsDir: dir })).applied).toEqual(['0001_probe.sql']);

    // 模拟旧执行器留下的记录（只有 version）。
    await db.query(`update public.schema_migrations set sha256 = null where version = '0001_probe.sql'`);
    expect((await migrate(db, { migrationsDir: dir })).applied).toEqual([]);
    expect((await hashes())['0001_probe.sql']).toMatch(/^[0-9a-f]{64}$/);
  });
});
