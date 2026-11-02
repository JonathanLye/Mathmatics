import {
  deserializeState,
  gateRule,
  helpPreview,
  nextKey,
  type AttemptState,
  type Context,
  type EngineEvent,
  type HelpPreview,
  type SerializedAttemptState,
} from '@proof-gym/engine';

import type { AttemptService } from '../attempts/service.ts';
import { loadProblem } from '../attempts/problem.ts';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { hintTextOf, REFUSAL_TEXT } from './hints.ts';
import { routeIntent, type RouteInput } from './intent.ts';
import { PREVIEW_TTL_MS, signPreview, verifyPreview } from './token.ts';

// 求助与领取提示（06 §4.2–4.3；09 §3 C4、C5）。
// 服务端只下发题目包里预写的提示文本：不调用模型，不把学生文本发往任何外部服务。
// 概念回答与行批注（concept / check_line）尚未实现：返回 reason = not_implemented，不假装有内容。
// H0/H1 不计透露量，直接经引擎下发；H2 起先给预览与令牌，领取时由引擎重新检查（06 §4.2 的 /hints/claim）。

export interface HelpDeps {
  db: Db;
  attempts: AttemptService;
  secret: string;
  now?: () => number;
}

export interface HelpService {
  help(userId: string, attemptId: string, input: RouteInput): Promise<Record<string, unknown>>;
  claim(userId: string, attemptId: string, previewToken: string): Promise<Record<string, unknown>>;
}

type Owned = { ctx: Context; state: AttemptState; stateVersion: number };
type Captured = { delivered: EngineEvent | null; denied: EngineEvent | null };

const DENIAL_TYPES: ReadonlySet<string> = new Set(['hint.deny', 'hint.rapid_lock', 'budget.exhausted', 'gate.block']);
const DENIAL_REASONS: ReadonlySet<string> = new Set(['layer', 'need_attempt', 'dwell', 'complete', 'rapid_lock']);

const previewExpired = () => new AppError('HINT_PREVIEW_EXPIRED', 409, '预览已过期，请重新求助');

// 引擎的拒绝结果：hint.deny / hint.rapid_lock / budget.exhausted / gate.block 都是已记录的事件，不是异常。
function capture(out: Captured) {
  return async (_tx: unknown, _row: unknown, result: { events: EngineEvent[] }) => {
    out.delivered = result.events.find((e) => e.type === 'hint.deliver') ?? null;
    out.denied = result.events.find((e) => DENIAL_TYPES.has(e.type)) ?? null;
  };
}

function denyReason(event: EngineEvent | null): string {
  if (!event) return 'unknown';
  if (event.type === 'hint.rapid_lock') return 'rapid_lock';
  if (event.type === 'budget.exhausted') return 'budget';
  if (event.type === 'gate.block') return 'gate';
  const reason = String(event.payload.reason);
  return DENIAL_REASONS.has(reason) ? reason : 'unknown';
}

// 预检（只用于 H2 起不走引擎的情况）：与 helpPreview 的字段对应，顺序决定返回哪个原因。
function blockReason(owned: Owned, preview: HelpPreview): string | null {
  if (owned.state.layer !== 3) return 'layer';
  if (preview.rapidLockUntil !== null) return 'rapid_lock';
  if (preview.waitSec !== null) return 'dwell';
  if (preview.needAttempt) return 'need_attempt';
  if (preview.exhausted) return 'budget';
  if (preview.nextLevel === null || preview.nextCost === null) return 'complete';
  return null;
}

export function createHelpService(deps: HelpDeps): HelpService {
  const { db, attempts, secret } = deps;
  const now = deps.now ?? (() => Date.now());

  async function loadOwned(userId: string, attemptId: string): Promise<Owned> {
    const row = (
      await db.query<{
        user_id: string;
        problem_id: string;
        problem_version: number;
        state: SerializedAttemptState;
        state_version: number;
      }>(`select user_id, problem_id, problem_version, state, state_version from app.attempts where id = $1`, [attemptId])
    ).rows[0];
    if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    const problem = await loadProblem(db, row.problem_id, row.problem_version);
    return { ctx: problem.ctx, state: deserializeState(row.state), stateVersion: row.state_version };
  }

  function hintNote(owned: Owned, event: EngineEvent): Record<string, unknown> {
    const keyId = String(event.payload.key);
    const level = String(event.payload.level);
    const cost = Number(event.payload.cost);
    const text = hintTextOf(owned.ctx.pkg.secret, keyId, level) ?? '';
    return { kind: 'hint', who: `${level} · 透露 ${cost}`, level, cost, text };
  }

  // 拒绝文案：固定一句。如果预写的 H0 指向性提示通过闸门，就附在后面；否则只给拒绝文案。
  function refusalNote(owned: Owned): Record<string, unknown> {
    const key = nextKey(owned.ctx.pkg.secret, owned.state.hint.matched);
    const h0 = key ? hintTextOf(owned.ctx.pkg.secret, key.id, 'H0') : null;
    const candidate = h0 ? `${REFUSAL_TEXT} ${h0}` : REFUSAL_TEXT;
    const gate = gateRule(owned.ctx.pkg.secret, candidate, new Set(owned.state.hint.matched), []);
    return { kind: 'refusal', who: '批注', text: gate.ok ? candidate : REFUSAL_TEXT };
  }

  return {
    async help(userId, attemptId, input) {
      const routed = routeIntent(input);
      if (routed === 'pressure') {
        const owned = await loadOwned(userId, attemptId);
        return { routed, note: refusalNote(owned), state: await attempts.get(userId, attemptId) };
      }
      if (routed !== 'stuck') {
        return {
          routed,
          note: null,
          preview: { allowed: false, reason: 'not_implemented' },
          state: await attempts.get(userId, attemptId),
        };
      }

      const owned = await loadOwned(userId, attemptId);
      const preview = helpPreview(owned.ctx, owned.state, now());
      const blocked = (reason: string) => ({ routed, preview: { allowed: false, reason }, state: undefined });

      // 不在第 3 层：直接给原因，不写事件。
      if (owned.state.layer !== 3) return { ...blocked('layer'), state: await attempts.get(userId, attemptId) };

      // H0/H1 与"已无可用提示"：交给引擎判定并记录结果（hint.deny 等）。
      if (preview.nextLevel === null || preview.nextLevel === 'H0' || preview.nextLevel === 'H1') {
        const out: Captured = { delivered: null, denied: null };
        const state = await attempts.command({
          userId,
          attemptId,
          build: () => ({ kind: 'hint.request' }),
          record: capture(out),
        });
        if (!out.delivered) return { routed, preview: { allowed: false, reason: denyReason(out.denied) }, state };
        return { routed, note: hintNote(owned, out.delivered), state };
      }

      const reason = blockReason(owned, preview);
      if (reason !== null) return { ...blocked(reason), state: await attempts.get(userId, attemptId) };

      // H2 起：预览 + 60 秒令牌，绑定作答、层级与状态版本。领取时引擎会再查一遍。
      const previewToken = signPreview(secret, {
        attemptId,
        level: String(preview.nextLevel),
        stateVersion: owned.stateVersion,
        expiresAt: now() + PREVIEW_TTL_MS,
      });
      return {
        routed,
        preview: {
          allowed: true,
          reason: null,
          level: preview.nextLevel,
          cost: preview.nextCost,
          revealAfter: owned.state.hint.reveal + Number(preview.nextCost),
          previewToken,
        },
        state: await attempts.get(userId, attemptId),
      };
    },

    async claim(userId, attemptId, previewToken) {
      const claims = verifyPreview(secret, previewToken, now());
      if (!claims || claims.attemptId !== attemptId) throw previewExpired();
      const owned = await loadOwned(userId, attemptId);
      if (owned.stateVersion !== claims.stateVersion) throw previewExpired();

      const out: Captured = { delivered: null, denied: null };
      let state: Record<string, unknown>;
      try {
        state = await attempts.command({
          userId,
          attemptId,
          ifMatch: claims.stateVersion,
          build: () => ({ kind: 'hint.request' }),
          record: capture(out),
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'STATE_STALE') throw previewExpired();
        throw error;
      }
      if (!out.delivered) {
        if (denyReason(out.denied) === 'rapid_lock') throw new AppError('HINT_RATE_LIMITED', 429, '求助太频繁，请稍后再试');
        throw new AppError('HINT_NOT_ALLOWED', 409, '当前不能领取提示');
      }
      if (out.delivered.payload.level !== claims.level) throw previewExpired();
      return { routed: 'stuck', note: hintNote(owned, out.delivered), state };
    },
  };
}
