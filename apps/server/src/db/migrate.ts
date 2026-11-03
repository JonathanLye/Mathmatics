import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Db } from './index.ts';

// 07 §8：初始结构 = contracts/schema.sql（始终是最新全量结构）；之后每次变更写一份增量 SQL
// apps/server/migrations/NNNN_名字.sql，并同步改 schema.sql。
//
// - 新库：执行 schema.sql，并把 migrations/ 里已有的文件全部记为已应用（它们已经包含在 schema.sql 里）。
// - 旧库（有 app.users 但没有 schema_migrations，即由旧版 db:migrate 建成）：只记基线 0000_init，
//   然后执行 migrations/ 里全部文件。
// - 之后：只执行没记录过的文件，按文件名顺序；失败整个事务回滚，不记录。
// 整个过程在一个事务里，并持有 advisory 锁，多个实例同时迁移也只会有一个真正执行。
// 已记录的文件会校验 sha256：迁移文件合入后不可再改（07 §8），改了直接报错。
export const BASELINE_VERSION = '0000_init';
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727_274_101;

export interface MigrateOptions {
  migrationsDir?: string;
  schemaSql?: string;
}

export interface MigrateResult {
  initialized: boolean;
  baselined: boolean;
  applied: string[];
}

function migrationFiles(dir: string): string[] {
  const files = readdirSync(dir).filter((name) => name !== 'README.md' && !name.startsWith('.'));
  for (const name of files) {
    const match = FILE_PATTERN.exec(name);
    if (!match || match[1] === '0000') {
      throw new Error(`迁移文件名不合法：${name}（需为 NNNN_名字.sql，NNNN 从 0001 开始）`);
    }
  }
  return files.sort();
}

function fileSha256(dir: string, file: string): string {
  return createHash('sha256').update(readFileSync(`${dir}/${file}`)).digest('hex');
}

function defaultSchemaSql(): string {
  return readFileSync(fileURLToPath(import.meta.resolve('@proof-gym/contracts/schema.sql')), 'utf8');
}

export async function migrate(db: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  const dir = options.migrationsDir ?? MIGRATIONS_DIR;
  const files = migrationFiles(dir);

  return db.tx(async (tx) => {
    // 迁移可能包含大表 DDL，不能受连接池 15s statement_timeout 限制；SET LOCAL 只影响本事务，提交/回滚即恢复。
    // PGlite 没有这些 GUC，只在真实 pg 驱动上设置。
    if (db.driver === 'pg') {
      await tx.query('set local statement_timeout = 0');
      await tx.query('set local idle_in_transaction_session_timeout = 0');
    }
    await tx.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await tx.exec(
      `create table if not exists public.schema_migrations (
         version text primary key,
         sha256 text,
         applied_at timestamptz not null default now()
       )`,
    );
    await tx.exec('alter table public.schema_migrations add column if not exists sha256 text');
    const done = new Map(
      (
        await tx.query<{ version: string; sha256: string | null }>('select version, sha256 from public.schema_migrations')
      ).rows.map((r) => [r.version, r.sha256] as const),
    );
    const record = (version: string, sha256: string | null) =>
      tx.query('insert into public.schema_migrations (version, sha256) values ($1, $2)', [version, sha256]);

    const result: MigrateResult = { initialized: false, baselined: false, applied: [] };

    if (!done.has(BASELINE_VERSION)) {
      const legacy = (await tx.query<{ legacy: boolean }>(`select to_regclass('app.users') is not null as legacy`)).rows[0]?.legacy === true;
      if (legacy) {
        result.baselined = true;
      } else {
        await tx.exec(options.schemaSql ?? defaultSchemaSql());
        result.initialized = true;
        for (const file of files) {
          await record(file, fileSha256(dir, file));
          done.set(file, fileSha256(dir, file));
        }
      }
      await record(BASELINE_VERSION, null);
      done.set(BASELINE_VERSION, null);
    }

    for (const file of files) {
      const sha = fileSha256(dir, file);
      const recorded = done.get(file);
      if (recorded !== undefined) {
        if (recorded !== null && recorded !== sha) {
          throw new Error(`迁移文件已被修改：${file}（记录 sha256=${recorded}，当前=${sha}）。请新增一个迁移文件，不要改已合入的文件`);
        }
        if (recorded === null) {
          // 旧版执行器只记 version：第一次遇到时补上 hash，此后同样不可改。
          await tx.query('update public.schema_migrations set sha256 = $2 where version = $1', [file, sha]);
        }
        continue;
      }
      await tx.exec(readFileSync(`${dir}/${file}`, 'utf8'));
      await record(file, sha);
      result.applied.push(file);
    }
    return result;
  });
}
