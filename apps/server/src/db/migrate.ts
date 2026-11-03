import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Db } from './index.ts';

// 07 §8：初始结构 = contracts/schema.sql（始终是最新全量结构）；之后每次变更写一份增量 SQL
// apps/server/migrations/NNNN_名字.sql，并同步改 schema.sql。
//
// - 新库：执行 schema.sql，并把 migrations/ 里已有的文件全部记为已应用（它们已经包含在 schema.sql 里）。
// - 旧库（有 app.users 但没有 schema_migrations，即由旧版 db:migrate 建成）：只记基线 0000_init，
//   然后执行 migrations/ 里全部文件。
// - 之后：只执行没记录过的文件，按文件名顺序，每个文件一个事务；失败整个回滚，不记录。
// 整个过程在一个事务里，并持有 advisory 锁，多个实例同时迁移也只会有一个真正执行。
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

function defaultSchemaSql(): string {
  return readFileSync(fileURLToPath(import.meta.resolve('@proof-gym/contracts/schema.sql')), 'utf8');
}

export async function migrate(db: Db, options: MigrateOptions = {}): Promise<MigrateResult> {
  const dir = options.migrationsDir ?? MIGRATIONS_DIR;
  const files = migrationFiles(dir);

  return db.tx(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await tx.exec(
      `create table if not exists public.schema_migrations (
         version text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const done = new Set((await tx.query<{ version: string }>('select version from public.schema_migrations')).rows.map((r) => r.version));
    const record = (version: string) => tx.query('insert into public.schema_migrations (version) values ($1)', [version]);

    const result: MigrateResult = { initialized: false, baselined: false, applied: [] };

    if (!done.has(BASELINE_VERSION)) {
      const legacy = (await tx.query<{ legacy: boolean }>(`select to_regclass('app.users') is not null as legacy`)).rows[0]?.legacy === true;
      if (legacy) {
        result.baselined = true;
      } else {
        await tx.exec(options.schemaSql ?? defaultSchemaSql());
        result.initialized = true;
        for (const file of files) {
          await record(file);
          done.add(file);
        }
      }
      await record(BASELINE_VERSION);
      done.add(BASELINE_VERSION);
    }

    for (const file of files) {
      if (done.has(file)) continue;
      await tx.exec(readFileSync(`${dir}/${file}`, 'utf8'));
      await record(file);
      result.applied.push(file);
    }
    return result;
  });
}
