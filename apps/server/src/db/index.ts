import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { Pool, type PoolClient } from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

// 事务里额外提供 exec：执行不带参数的多语句 SQL（迁移文件）。
export interface TxQueryable extends Queryable {
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly driver: 'pglite' | 'pg';
  exec(sql: string): Promise<void>;
  tx<T>(fn: (tx: TxQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  databaseUrl?: string;
  pgliteDir?: string;
}

function makeQueryable(
  run: (sql: string, params: readonly unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null | undefined }>,
): Queryable {
  return {
    async query<T extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const result = await run(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
  };
}

async function openPglite(dir: string): Promise<Db> {
  if (dir !== 'memory') mkdirSync(dir, { recursive: true });
  const client = dir === 'memory' ? new PGlite() : new PGlite(dir);
  await client.waitReady;

  const run = async (sql: string, params: readonly unknown[]) => {
    const result = await client.query(sql, params as unknown[]);
    return { rows: result.rows as unknown[], rowCount: result.affectedRows };
  };

  return {
    driver: 'pglite',
    ...makeQueryable(run),
    async exec(sql) {
      await client.exec(sql);
    },
    async tx(fn) {
      return client.transaction((tx) =>
        fn({
          ...makeQueryable(async (sql, params) => {
            const result = await tx.query(sql, params as unknown[]);
            return { rows: result.rows as unknown[], rowCount: result.affectedRows };
          }),
          async exec(sql) {
            await tx.exec(sql);
          },
        }),
      );
    },
    async close() {
      await client.close();
    },
  };
}

function makePgQueryable(client: Pool | PoolClient): Queryable {
  return makeQueryable(async (sql, params) => {
    const result = await client.query(sql, params as unknown[]);
    return { rows: result.rows as unknown[], rowCount: result.rowCount };
  });
}

async function openPg(connectionString: string): Promise<Db> {
  const pool = new Pool({ connectionString });

  return {
    driver: 'pg',
    ...makePgQueryable(pool),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          ...makePgQueryable(client),
          async exec(sql) {
            await client.query(sql);
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function openDb(options: OpenDbOptions = {}): Promise<Db> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl !== '') return openPg(databaseUrl);
  return openPglite(options.pgliteDir ?? process.env.PGLITE_DIR ?? '.data/pglite');
}

export async function applySchema(db: Db): Promise<void> {
  const schemaUrl = import.meta.resolve('@proof-gym/contracts/schema.sql');
  await db.exec(readFileSync(fileURLToPath(schemaUrl), 'utf8'));
}

export { migrate } from './migrate.ts';
export type { MigrateOptions, MigrateResult } from './migrate.ts';
export { seedContent } from './seed.ts';
export type { SeedSummary } from './seed.ts';
