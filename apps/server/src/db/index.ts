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

export interface Db extends Queryable {
  readonly driver: 'pglite' | 'pg';
  exec(sql: string): Promise<void>;
  tx<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface OpenDbOptions {
  databaseUrl?: string;
  pgliteDir?: string;
  // 池里空闲连接出错（数据库重启、网络中断）时调用。不传则写 stderr。
  onPoolError?: (error: Error) => void;
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
        fn(
          makeQueryable(async (sql, params) => {
            const result = await tx.query(sql, params as unknown[]);
            return { rows: result.rows as unknown[], rowCount: result.affectedRows };
          }),
        ),
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

// 超时都在连接上设置，数据库侧也会强制：一次慢查询或忘了提交的事务不能把 10 个连接占满。
export const PG_POOL_SETTINGS = {
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 20_000,
} as const;

// node-postgres：池里空闲连接出错会在池上触发 'error'，没有监听器时 Node 抛未捕获错误，进程崩溃
// （https://node-postgres.com/apis/pool#error）。出错的连接会被池自动丢弃，所以这里只记录。
export function createPgPool(connectionString: string, onError: (error: Error) => void): Pool {
  const pool = new Pool({ connectionString, ...PG_POOL_SETTINGS });
  pool.on('error', onError);
  return pool;
}

async function openPg(connectionString: string, onPoolError: (error: Error) => void): Promise<Db> {
  const pool = createPgPool(connectionString, onPoolError);

  return {
    driver: 'pg',
    ...makePgQueryable(pool),
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      // 回滚失败说明连接已损坏：必须带错误释放（pool 会销毁它），而不是放回池里；原始错误不能被回滚错误盖掉。
      let broken: Error | undefined;
      try {
        await client.query('BEGIN');
        const result = await fn(makePgQueryable(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function openDb(options: OpenDbOptions = {}): Promise<Db> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl !== '') {
    return openPg(databaseUrl, options.onPoolError ?? ((error) => console.error('pg pool idle client error', error)));
  }
  return openPglite(options.pgliteDir ?? process.env.PGLITE_DIR ?? '.data/pglite');
}

export async function applySchema(db: Db): Promise<void> {
  const schemaUrl = import.meta.resolve('@proof-gym/contracts/schema.sql');
  await db.exec(readFileSync(fileURLToPath(schemaUrl), 'utf8'));
}

export { seedContent } from './seed.ts';
export type { SeedSummary } from './seed.ts';
