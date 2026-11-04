import { randomUUID } from 'node:crypto';

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
// 概念回答与行批注（concept / check_line）：从概念库与 app.attempt_lines 生成 Note（06 §4.2），不调用模型。
// H0/H1 不计透露量，直接经引擎下发；H2 起先给预览与令牌，领取时由引擎重新检查（06 §4.2 的 /hints/claim）。
// 测验模式关闭提示（11 §5.2 的测验时段"关提示"）：stuck 返回 preview.reason = test_mode。

export interface HelpDeps {
  db: Db;
  attempts: AttemptService;
  secret: string;
  now?: () => number;
}

export interface HelpService {
  // extra.lineId：check_line 指向的行（只作记录，不参与路由）。
  help(userId: string, attemptId: string, input: RouteInput, extra?: { lineId?: string }): Promise<Record<string, unknown>>;
  claim(userId: string, attemptId: string, previewToken: string): Promise<Record<string, unknown>>;
}

type Owned = { ctx: Context; state: AttemptState; stateVersion: number; mode: string };
type Captured = { delivered: EngineEvent | null; denied: EngineEvent | null };
type Block = { reason: string; waitSec: number | null };

const DENIAL_TYPES: ReadonlySet<string> = new Set(['hint.deny', 'hint.rapid_lock', 'budget.exhausted', 'gate.block']);
// 与 HelpResult.preview.reason 的枚举一致（06 §4.2）。引擎里其它原因（如 gate）映射为 null，不新造枚举值。
const PREVIEW_REASONS: ReadonlySet<string> = new Set(['need_attempt', 'dwell', 'rapid_lock', 'budget', 'layer', 'complete']);

const previewExpired = () => new AppError('HINT_PREVIEW_EXPIRED', 409, '预览已过期，请重新求助');

// 引擎的拒绝结果：hint.deny / hint.rapid_lock / budget.exhausted / gate.block 都是已记录的事件，不是异常。
function capture(out: Captured) {
  return async (_tx: unknown, _row: unknown, result: { events: EngineEvent[] }) => {
    out.delivered = result.events.find((e) => e.type === 'hint.deliver') ?? null;
    out.denied = result.events.find((e) => DENIAL_TYPES.has(e.type)) ?? null;
  };
}

// 引擎拒绝的事件 → 预览的原因与等待秒数。
function denial(event: EngineEvent | null, now: number): { reason: string | null; waitSec: number | null } {
  if (!event) return { reason: null, waitSec: null };
  if (event.type === 'hint.rapid_lock') return { reason: 'rapid_lock', waitSec: secondsUntil(String(event.payload.until), now) };
  if (event.type === 'budget.exhausted') return { reason: 'budget', waitSec: null };
  if (event.type === 'gate.block') return { reason: null, waitSec: null };
  const reason = String(event.payload.reason);
  if (!PREVIEW_REASONS.has(reason)) return { reason: null, waitSec: null };
  const waitSec = reason === 'dwell' || reason === 'rapid_lock' ? Number(event.payload.waitSec) : null;
  return { reason, waitSec };
}

function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

// 领取失败的错误码与细节（06 §5 的错误表）。gate 没有对应错误码，用 HINT_NOT_READY 且不带细节。
function claimFailure(event: EngineEvent | null, now: number): AppError {
  const { reason, waitSec } = denial(event, now);
  if (reason === 'rapid_lock') return new AppError('RATE_LIMITED', 429, '求助太频繁，请稍后再试', { waitSec });
  if (reason === 'budget') return new AppError('BUDGET_EXHAUSTED', 429, '透露额度已用完', { softLanding: [] });
  const detail: Record<string, unknown> = {};
  if (reason === 'need_attempt') detail.needAttempt = true;
  if (reason === 'dwell') detail.waitSec = waitSec;
  return new AppError('HINT_NOT_READY', 409, '门槛未满足', detail);
}

// 预检（H2 起不经过引擎时）：顺序与引擎 selectHint 一致（rapid → needs_submit → dwell → budget）。
function blockOf(owned: Owned, preview: HelpPreview): Block | null {
  if (owned.state.layer !== 3) return { reason: 'layer', waitSec: null };
  if (preview.rapidLockUntil !== null) return { reason: 'rapid_lock', waitSec: preview.waitSec };
  if (preview.needAttempt) return { reason: 'need_attempt', waitSec: null };
  if (preview.waitSec !== null) return { reason: 'dwell', waitSec: preview.waitSec };
  if (preview.exhausted) return { reason: 'budget', waitSec: null };
  if (preview.nextLevel === null || preview.nextCost === null) return { reason: 'complete', waitSec: null };
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
        mode: string;
      }>(
        `select user_id, problem_id, problem_version, state, state_version, mode from app.attempts where id = $1`,
        [attemptId],
      )
    ).rows[0];
    if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    const problem = await loadProblem(db, row.problem_id, row.problem_version);
    return { ctx: problem.ctx, state: deserializeState(row.state), stateVersion: row.state_version, mode: row.mode };
  }

  // 批注的统一形状（contracts Note：noteId、kind、who、text、at；不允许多余字段）。
  function noteOf(kind: string, who: string, text: string): Record<string, unknown> {
    return { noteId: randomUUID(), kind, who, text, at: new Date(now()).toISOString() };
  }

  // 概念解释（06 §4.2）：取本题 public.def.conceptId 对应的概念词条（最新版本），给白话要点；
  // 概念库里没有该词条时返回 null（不假装有内容）。
  async function conceptNote(owned: Owned): Promise<Record<string, unknown> | null> {
    const conceptId = owned.ctx.pkg.public.def?.conceptId;
    if (conceptId === undefined || conceptId === '') return null;
    const row = await db.query<{
      body: { title?: string; definition?: string; card?: { plain?: string } };
    }>(`select body from content.concepts where id = $1 order by version desc limit 1`, [conceptId]);
    const concept = row.rows[0]?.body;
    if (!concept) return null;
    const plain = concept.card?.plain?.trim() ?? '';
    const text = plain !== '' ? `${concept.title ?? conceptId}：${plain}` : (concept.definition ?? concept.title ?? '').trim();
    if (text === '') return null;
    return { ...noteOf('concept', '助教', text), level: 'H0', lessonConceptId: conceptId };
  }

  // 行批注（06 §4.2）：指向指定行（缺省最新一行）；依据缺失时追问，否则确认衔接。
  async function checkLineNote(attemptId: string, lineId?: string): Promise<Record<string, unknown> | null> {
    const row =
      lineId !== undefined
        ? (
            await db.query<{ id: string; justification: string | null }>(
              `select id, justification from app.attempt_lines where id = $1 and attempt_id = $2`,
              [lineId, attemptId],
            )
          ).rows[0]
        : (
            await db.query<{ id: string; justification: string | null }>(
              `select id, justification from app.attempt_lines where attempt_id = $1 order by created_at desc, idx desc limit 1`,
              [attemptId],
            )
          ).rows[0];
    if (!row) return null;
    const missing = row.justification === null || row.justification.trim() === '';
    const text = missing ? '依据没写。它由哪条定义或已证结论得到？' : '这一行和前面衔接上了。';
    return { ...noteOf('annotation', '批注', text), lineId: row.id };
  }

  function hintNote(owned: Owned, event: EngineEvent): Record<string, unknown> {
    const keyId = String(event.payload.key);
    const level = String(event.payload.level);
    const cost = Number(event.payload.cost);
    const text = hintTextOf(owned.ctx.pkg.secret, keyId, level) ?? '';
    return noteOf('hint', `${level} · 透露 ${cost}`, text);
  }

  // 拒绝文案：固定一句。练习模式下，如果预写的 H0 指向性提示通过闸门，就附在后面；否则只给拒绝文案。
  function refusalNote(owned: Owned): Record<string, unknown> {
    // 测验模式关提示（11 §5.2）：只给一句拒绝，不附 H0。
    if (owned.mode === 'test') return noteOf('refusal', '批注', REFUSAL_TEXT);
    const key = nextKey(owned.ctx.pkg.secret, owned.state.hint.matched);
    const h0 = key ? hintTextOf(owned.ctx.pkg.secret, key.id, 'H0') : null;
    const candidate = h0 ? `${REFUSAL_TEXT} ${h0}` : REFUSAL_TEXT;
    const gate = gateRule(owned.ctx.pkg.secret, candidate, new Set(owned.state.hint.matched), []);
    return noteOf('refusal', '批注', gate.ok ? candidate : REFUSAL_TEXT);
  }

  const blockedPreview = (block: Block) => ({ allowed: false, reason: block.reason, waitSec: block.waitSec });

  return {
    async help(userId, attemptId, input, extra = {}) {
      const routed = routeIntent(input);
      const owned = await loadOwned(userId, attemptId);
      // 08 §3：每次求助先记 help.request（含施压、概念、行检查），再产生后续的 hint.* 事件，顺序与实际一致。
      const helpId = await attempts.recordHelp(userId, attemptId, {
        intent: input.intent,
        routed,
        routedBy: input.intent === 'free' ? 'rule' : 'chip',
        ...(input.intent === 'free' ? { text: input.text } : {}),
        ...(extra.lineId === undefined ? {} : { lineId: extra.lineId }),
      });
      if (routed === 'pressure') {
        await attempts.setHelpOutcome(helpId, 'refusal');
        return { routed, note: refusalNote(owned), state: await attempts.get(userId, attemptId) };
      }
      if (routed === 'concept') {
        const note = await conceptNote(owned);
        await attempts.setHelpOutcome(helpId, 'concept');
        const state = await attempts.get(userId, attemptId);
        return note === null ? { routed, state } : { routed, note, state };
      }
      if (routed === 'check_line') {
        const note = await checkLineNote(attemptId, extra.lineId);
        await attempts.setHelpOutcome(helpId, 'annotation');
        const state = await attempts.get(userId, attemptId);
        return note === null ? { routed, state } : { routed, note, state };
      }
      if (routed !== 'stuck') {
        return { routed, state: await attempts.get(userId, attemptId) };
      }
      if (owned.mode === 'test') {
        await attempts.setHelpOutcome(helpId, 'denied');
        return { routed, preview: blockedPreview({ reason: 'test_mode', waitSec: null }), state: await attempts.get(userId, attemptId) };
      }
      if (owned.state.layer !== 3) {
        await attempts.setHelpOutcome(helpId, 'denied');
        return { routed, preview: blockedPreview({ reason: 'layer', waitSec: null }), state: await attempts.get(userId, attemptId) };
      }

      const preview = helpPreview(owned.ctx, owned.state, now());

      // H0/H1 与"已无可用提示"：交给引擎判定并记录结果（hint.deny 等）。
      if (preview.nextLevel === null || preview.nextLevel === 'H0' || preview.nextLevel === 'H1') {
        const out: Captured = { delivered: null, denied: null };
        const state = await attempts.command({
          userId,
          attemptId,
          build: () => ({ kind: 'hint.request' }),
          record: capture(out),
        });
        if (!out.delivered) {
          const { reason, waitSec } = denial(out.denied, now());
          await attempts.setHelpOutcome(helpId, 'denied');
          return { routed, preview: { allowed: false, reason, waitSec }, state };
        }
        await attempts.setHelpOutcome(helpId, 'hint');
        return { routed, note: hintNote(owned, out.delivered), state };
      }

      const block = blockOf(owned, preview);
      if (block !== null) {
        await attempts.setHelpOutcome(helpId, 'denied');
        return { routed, preview: blockedPreview(block), state: await attempts.get(userId, attemptId) };
      }

      // H2 起：预览 + 60 秒令牌，绑定作答、层级与状态版本。领取时引擎会再查一遍。
      const previewToken = signPreview(secret, {
        attemptId,
        level: String(preview.nextLevel),
        stateVersion: owned.stateVersion,
        expiresAt: now() + PREVIEW_TTL_MS,
        ...(helpId === null ? {} : { helpId }),
      });
      return {
        routed,
        preview: {
          allowed: true,
          reason: null,
          waitSec: null,
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
      if (owned.mode === 'test') throw new AppError('TEST_MODE_RESTRICTED', 403, '本布置不允许提示');
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
        if (claims.helpId) await attempts.setHelpOutcome(claims.helpId, 'denied');
        throw claimFailure(out.denied, now());
      }
      if (out.delivered.payload.level !== claims.level) throw previewExpired();
      if (claims.helpId) await attempts.setHelpOutcome(claims.helpId, 'hint');
      return { routed: 'stuck', note: hintNote(owned, out.delivered), state };
    },
  };
}
