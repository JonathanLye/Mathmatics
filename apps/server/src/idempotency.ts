import { createHash } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { currentAuth } from './auth/session.ts';
import type { Db } from './db/index.ts';
import { AppError } from './errors.ts';

// 写接口幂等（06 §1）：同一用户的同一 Idempotency-Key，24 小时内重放返回首次成功的响应，不再执行。
//
// 流程：preHandler 先在 app.idempotency_keys 占位（唯一键 (user_id, key)），再让处理器执行；
// onSend 把 2xx 响应存下来，其它状态码则释放占位（失败的请求没有副作用，允许重试）。
// - 同键不同请求（方法/路径/请求体不同）→ 422，不执行；
// - 同键的请求正在处理 → 等它结束后重放；等太久返回 429（detail.waitSec），客户端稍后重试；
// - 占位超过 STALE_CLAIM_SECONDS 仍无响应（进程崩溃）→ 视为遗弃，允许**同一个请求**接管；
//   不同请求体不接管，直接 422（否则同键会被另一份请求“借尸还魂”）。
// 没有带 Idempotency-Key 的请求照旧执行（If-Match 仍是并发保护）。
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REPLAY_HEADER = 'idempotent-replayed';
export const KEY_TTL_HOURS = 24;
export const STALE_CLAIM_SECONDS = 30;
const DEFAULT_WAIT_MS = 3_000;
const DEFAULT_POLL_MS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Claim {
  userId: string;
  key: string;
}

type StoredRow = {
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
  stale: boolean;
};

export interface IdempotencyOptions {
  // 测试注入：默认 3 秒等待上限、50ms 轮询。
  waitMs?: number;
  pollMs?: number;
}

export interface Idempotency {
  preHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined>;
  onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown>;
}

// 同一逻辑请求的 body 键序不应影响 hash；数组顺序保留（数组顺序通常是语义的一部分）。
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

export function requestHash(request: FastifyRequest): string {
  const path = request.url.split('?')[0] ?? request.url;
  return createHash('sha256').update(`${request.method} ${path}\n${stableStringify(request.body ?? null)}`).digest('hex');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 定时清理（server.ts 每小时调用一次）；tryClaim 里的顺手清理只覆盖带键请求。
export async function cleanupExpiredIdempotencyKeys(db: Db, ttlHours = KEY_TTL_HOURS): Promise<number> {
  const result = await db.query(`delete from app.idempotency_keys where created_at < now() - make_interval(hours => $1)`, [
    ttlHours,
  ]);
  return result.rowCount;
}

export function createIdempotency(db: Db, options: IdempotencyOptions = {}): Idempotency {
  const claims = new WeakMap<FastifyRequest, Claim>();
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;

  async function tryClaim(userId: string, key: string, hash: string): Promise<boolean> {
    // 过期的键顺手清理；(created_at) 有索引，没有过期行时这条是空操作。
    await cleanupExpiredIdempotencyKeys(db);
    const inserted = await db.query(
      `insert into app.idempotency_keys (user_id, key, request_hash) values ($1, $2, $3)
       on conflict do nothing returning key`,
      [userId, key, hash],
    );
    return inserted.rows.length > 0;
  }

  async function preHandler(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const raw = request.headers[IDEMPOTENCY_HEADER];
    if (raw === undefined) return undefined;
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (key === undefined || !UUID.test(key)) {
      throw new AppError('VALIDATION_FAILED', 422, 'Idempotency-Key 需为 uuid');
    }
    // 未登录的请求交给处理器自己返回 401；这里不占位。
    const auth = await currentAuth(db, request);
    if (!auth) return undefined;

    const hash = requestHash(request);
    const deadline = Date.now() + waitMs;
    for (;;) {
      if (await tryClaim(auth.userId, key, hash)) {
        claims.set(request, { userId: auth.userId, key });
        return undefined;
      }
      const row = (
        await db.query<StoredRow>(
          `select request_hash, response_status, response_body,
                  created_at < now() - make_interval(secs => $3) as stale
             from app.idempotency_keys where user_id = $1 and key = $2`,
          [auth.userId, key, STALE_CLAIM_SECONDS],
        )
      ).rows[0];
      if (!row) continue; // 占位在两次查询之间被释放：重新抢
      if (row.request_hash !== hash) {
        throw new AppError('VALIDATION_FAILED', 422, '同一个 Idempotency-Key 不能用于不同的请求', {
          reason: 'idempotency_key_reused',
        });
      }
      if (row.response_status === null && row.stale) {
        // 之前的处理器崩溃，占位被遗弃：只删除仍无响应的那一行，然后重新抢（hash 已确认相同）。
        await db.query(
          `delete from app.idempotency_keys where user_id = $1 and key = $2 and response_status is null`,
          [auth.userId, key],
        );
        continue;
      }
      if (row.response_status !== null && row.response_body !== null) {
        return reply
          .code(row.response_status)
          .header('content-type', 'application/json; charset=utf-8')
          .header(REPLAY_HEADER, 'true')
          .send(row.response_body);
      }
      if (Date.now() >= deadline) {
        throw new AppError('RATE_LIMITED', 429, '上一次相同的请求仍在处理，请稍后再试', { waitSec: 1 });
      }
      await sleep(pollMs);
    }
  }

  async function onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown> {
    const claim = claims.get(request);
    if (!claim) return payload;
    claims.delete(request);
    try {
      if (reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === 'string') {
        await db.query(
          `update app.idempotency_keys set response_status = $3, response_body = $4 where user_id = $1 and key = $2`,
          [claim.userId, claim.key, reply.statusCode, payload],
        );
      } else {
        await db.query(`delete from app.idempotency_keys where user_id = $1 and key = $2`, [claim.userId, claim.key]);
      }
    } catch (error) {
      // 存响应失败不能让已经成功的写入变成 500：占位会在 STALE_CLAIM_SECONDS 后被同一请求接管。
      request.log.error({ err: error }, 'idempotency: 保存响应失败');
    }
    return payload;
  }

  return { preHandler, onSend };
}
