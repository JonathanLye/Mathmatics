import { nextKey } from './classify.ts';
import type { Budget, HintLevel, Secret } from './types.ts';

// 选提示（09 §6）：完全不看模型，只看状态与时间。时间由调用方传入（毫秒）。
// 阶梯 H0–H4，透露量 0/0/0.5/1/1；同一步骤只按最高级计一次（只补差额）。
export interface HintState {
  matched: ReadonlySet<string>;
  hintLv: Readonly<Record<string, number>>;
  keyCost: Readonly<Record<string, number>>;
  reveal: number;
  lastHintAt: number | null;
  submitsSinceHint: number;
  hintTimes: readonly number[];
  blockedUntil: number | null;
  exhausted: boolean;
}

export function initialHintState(): HintState {
  return {
    matched: new Set(),
    hintLv: {},
    keyCost: {},
    reveal: 0,
    lastHintAt: null,
    submitsSinceHint: 1,
    hintTimes: [],
    blockedUntil: null,
    exhausted: false,
  };
}

export type HintDecision =
  | { type: 'deliver'; key: string; level: HintLevel; cost: number; revealDelta: number; revealAfter: number; text: string }
  | { type: 'complete' }
  | { type: 'blocked'; waitSec: number }
  | { type: 'rapid_lock'; waitSec: number }
  | { type: 'needs_submit' }
  | { type: 'dwell'; waitSec: number }
  | { type: 'budget_exhausted'; key: string };

interface HintPolicy {
  reveal: number;
  dwellMs: number;
  rapidWindowMs: number;
  rapidCount: number;
  rapidLockMs: number;
}

// 默认值与 v3 原型一致（DWELL 20 秒、30 秒内 3 次、锁 60 秒）；题目包 budget 可覆盖。
function policyOf(budget: Budget): HintPolicy {
  return {
    reveal: budget.reveal,
    dwellMs: (budget.dwellSec ?? 20) * 1000,
    rapidWindowMs: (budget.rapidWindowSec ?? 30) * 1000,
    rapidCount: budget.rapidCount ?? 3,
    rapidLockMs: (budget.rapidLockSec ?? 60) * 1000,
  };
}

const waitSecOf = (ms: number): number => Math.ceil(ms / 1000);

// 返回本次决定与请求之后的状态。每个通过"锁"检查的请求都会记入 hintTimes（与 v3 一致，包括被拒绝的请求）。
export function selectHint(
  secret: Secret,
  budget: Budget,
  state: HintState,
  now: number,
): { decision: HintDecision; state: HintState } {
  const policy = policyOf(budget);

  if (state.blockedUntil !== null && now < state.blockedUntil) {
    return { decision: { type: 'blocked', waitSec: waitSecOf(state.blockedUntil - now) }, state };
  }

  const hintTimes = [...state.hintTimes.filter((t) => now - t < policy.rapidWindowMs), now];
  const after: HintState = { ...state, hintTimes };

  if (hintTimes.length >= policy.rapidCount) {
    const locked = { ...after, blockedUntil: now + policy.rapidLockMs };
    return { decision: { type: 'rapid_lock', waitSec: policy.rapidLockMs / 1000 }, state: locked };
  }

  const key = nextKey(secret, state.matched);
  if (!key) return { decision: { type: 'complete' }, state: after };

  const lv = state.hintLv[key.id] ?? 0;
  const hint = key.hints[Math.min(lv, 4)];
  const prevCost = state.keyCost[key.id] ?? 0;
  const revealDelta = Math.max(0, hint.cost - prevCost);

  if (hint.cost > 0) {
    if (state.submitsSinceHint < 1) return { decision: { type: 'needs_submit' }, state: after };
    if (state.lastHintAt !== null && now - state.lastHintAt < policy.dwellMs) {
      const waitSec = waitSecOf(policy.dwellMs - (now - state.lastHintAt));
      return { decision: { type: 'dwell', waitSec }, state: after };
    }
    if (state.reveal + revealDelta > policy.reveal) {
      return { decision: { type: 'budget_exhausted', key: key.id }, state: { ...after, exhausted: true } };
    }
  }

  const revealAfter = state.reveal + revealDelta;
  const delivered: HintState = {
    ...after,
    hintLv: { ...state.hintLv, [key.id]: lv + 1 },
    // 只有收费级别才记入 keyCost（与 v3 一致）：免费的 H0/H1 不占位。
    keyCost: hint.cost > 0 ? { ...state.keyCost, [key.id]: Math.max(prevCost, hint.cost) } : state.keyCost,
    reveal: revealAfter,
    lastHintAt: now,
    submitsSinceHint: 0,
  };
  return {
    decision: {
      type: 'deliver',
      key: key.id,
      level: hint.level,
      cost: hint.cost,
      revealDelta,
      revealAfter,
      text: hint.text,
    },
    state: delivered,
  };
}
