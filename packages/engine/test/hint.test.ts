import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type HintState, initialHintState, selectHint } from '../src/hint.ts';
import type { Budget, ProblemPackage, Secret } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const epsN = JSON.parse(readFileSync(path.join(seedDir, 'epsN.json'), 'utf8')) as ProblemPackage;
const secret: Secret = epsN.secret;
const budget: Budget = epsN.public.budget;

const SEC = 1000;

// 依次发出提示请求。submitted：该请求之前学生刚提交过一行；at 单位为秒。
function run(steps: { at: number; submitted?: boolean }[], start: HintState = initialHintState()) {
  let state = start;
  return steps.map(({ at, submitted }) => {
    if (submitted) state = { ...state, submitsSinceHint: state.submitsSinceHint + 1 };
    const out = selectHint(secret, budget, state, at * SEC);
    state = out.state;
    return out.decision;
  });
}

describe('selectHint：H0–H4 阶梯、透露量与锁', () => {
  it('H0 免费，不需要先写一行，立即给出', () => {
    const [d] = run([{ at: 0 }]);
    expect(d).toEqual({
      type: 'deliver',
      key: 'K1',
      level: 'H0',
      cost: 0,
      revealDelta: 0,
      revealAfter: 0,
      text: secret.keys[0].hints[0].text,
    });
  });

  it('H2 需要先写一行：没有提交时 needs_submit', () => {
    // H0、H1 免费；第三次请求是 H2（透露 0.5），此前没有提交
    const out = run([{ at: 0 }, { at: 60 }, { at: 120 }]);
    expect(out[2]).toEqual({ type: 'needs_submit' });
  });

  it('H2 在 20 秒停留内再要：dwell；过了停留再要：透露 0.5', () => {
    const early = run([{ at: 0 }, { at: 60 }, { at: 70, submitted: true }]);
    expect(early[2]).toEqual({ type: 'dwell', waitSec: 10 });
    const late = run([{ at: 0 }, { at: 60 }, { at: 100, submitted: true }]);
    expect(late[2]).toMatchObject({ type: 'deliver', level: 'H2', cost: 0.5, revealDelta: 0.5, revealAfter: 0.5 });
  });

  it('同一步骤只补差额：H2（0.5）之后 H3（1）只再计 0.5，累计 1', () => {
    const out = run([{ at: 0 }, { at: 60 }, { at: 100, submitted: true }, { at: 130, submitted: true }]);
    expect(out[3]).toMatchObject({ type: 'deliver', level: 'H3', cost: 1, revealDelta: 0.5, revealAfter: 1 });
  });

  it('额度用尽：再要的透露超过上限时给出 budget_exhausted 并置 exhausted', () => {
    // 构造：K1、K2 已写出，K3 已有 H0、H1，累计透露已到上限 2。下一级 H2 需要 0.5，超额。
    const start: HintState = {
      ...initialHintState(),
      matched: new Set(['K1', 'K2']),
      hintLv: { K3: 2 },
      reveal: 2,
      submitsSinceHint: 1,
    };
    const { decision, state } = selectHint(secret, budget, start, 300 * SEC);
    expect(decision).toEqual({ type: 'budget_exhausted', key: 'K3' });
    expect(state.exhausted).toBe(true);
    expect(state.reveal).toBe(2);
  });

  it('快速请求：30 秒内第 3 次起只给温和提示（rapid_soft），不加锁，状态不变（U15）', () => {
    const start = { ...initialHintState() };
    const first = selectHint(secret, budget, start, 0);
    const second = selectHint(secret, budget, first.state, 1 * SEC);
    const third = selectHint(secret, budget, second.state, 2 * SEC);
    expect(third.decision).toEqual({ type: 'rapid_soft' });
    expect(third.state).toEqual(second.state);
    expect(third.state.blockedUntil).toBeNull();
    // 没有锁：窗口过去之后立刻恢复
    const later = selectHint(secret, budget, third.state, 40 * SEC);
    expect(later.decision.type).not.toBe('rapid_soft');
  });

  it('卡住满 stuckMs：收费提示不再要求先写一行；未卡住仍要求', () => {
    const atStart: HintState = { ...initialHintState(), hintLv: { K1: 2 }, submitsSinceHint: 0 };
    expect(selectHint(secret, budget, atStart, 100 * SEC).decision).toEqual({ type: 'needs_submit' });
    const stuck = selectHint(secret, budget, atStart, 100 * SEC, { stuck: true }).decision;
    expect(stuck).toMatchObject({ type: 'deliver', level: 'H2', cost: 0.5 });
  });

  it('30 秒窗口外的请求不计入快速请求', () => {
    const out = run([{ at: 0 }, { at: 1 }, { at: 40 }]);
    expect(out[2]).toEqual({ type: 'needs_submit' });
  });

  it('链条闭合后返回 complete', () => {
    const start: HintState = { ...initialHintState(), matched: new Set(['K1', 'K2', 'K3', 'K4']) };
    expect(run([{ at: 0 }], start)[0]).toEqual({ type: 'complete' });
  });

  it('题目包 budget 可覆盖停留时间（默认 20 秒，题目包可设 5 秒）', () => {
    // 第 0 秒 H0、第 40 秒 H1（免费，两次都在 30 秒快速窗口之外）、第 46 秒 H2 时检查停留
    const timeline = (b: Budget) => {
      const a = selectHint(secret, b, initialHintState(), 0);
      const c = selectHint(secret, b, a.state, 40 * SEC);
      return selectHint(secret, b, { ...c.state, submitsSinceHint: 1 }, 46 * SEC).decision;
    };
    expect(timeline({ ...budget, dwellSec: 5 })).toMatchObject({ type: 'deliver', level: 'H2' });
    expect(timeline(budget)).toEqual({ type: 'dwell', waitSec: 14 });
  });
});
