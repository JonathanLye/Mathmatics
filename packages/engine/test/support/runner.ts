import { isDeepStrictEqual } from 'node:util';

import {
  type AttemptState,
  type Command,
  type Context,
  createAttempt,
  type EngineEvent,
  selectHint,
  step,
} from '../../src/index.ts';

// 场景时钟：固定的 epoch 毫秒，保证 until 等 ISO 字段可以确定地生成。
export const BASE = Date.UTC(2026, 10, 3, 4, 0, 0);

export function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

// 驱动状态机的测试替身：按 v3 DEMO_SC 的动作顺序发命令，并在每个提示请求上核对 selectHint 与 apply 的一致性。
export class Runner {
  state: AttemptState;
  t: number;
  readonly events: EngineEvent[] = [];
  readonly mismatches: string[] = [];
  private seq = 0;
  private stepEvents: EngineEvent[] = [];

  private readonly ctx: Context;

  constructor(ctx: Context, start = BASE) {
    this.ctx = ctx;
    this.t = start;
    this.state = createAttempt(ctx, start);
  }

  beginStep(): void {
    this.stepEvents = [];
  }

  endStep(): { events: EngineEvent[]; state: AttemptState } {
    return { events: this.stepEvents, state: this.state };
  }

  private nextLineId(): string {
    this.seq += 1;
    return uuidOf(this.seq);
  }

  private send(cmd: Command, advanceMs: number): void {
    this.t += advanceMs;
    const before = this.state;
    const result = step(this.ctx, before, cmd, this.t);
    if (cmd.kind === 'hint.request' && before.layer === 3 && !result.events.some((e) => e.type === 'gate.block')) {
      const { state: expected } = selectHint(this.ctx.pkg.secret, this.ctx.pkg.public.budget, before.hint, this.t);
      if (!isDeepStrictEqual(expected, result.state.hint)) this.mismatches.push(`t=${this.t}`);
    }
    this.state = result.state;
    this.events.push(...result.events);
    this.stepEvents.push(...result.events);
  }

  // 与 v3 的 freeCooldown 等价：只跨过需要跨过的窗口（锁中则跨过锁，否则跨过 20 秒停留与 30 秒快速窗口）。
  cool(): void {
    const blocked = this.state.hint.blockedUntil;
    this.t = blocked !== null && blocked > this.t ? blocked + 1000 : this.t + 31000;
  }

  wait(seconds: number): void {
    this.t += seconds * 1000;
  }

  hint(): void {
    this.cool();
    this.send({ kind: 'hint.request' }, 0);
  }

  burst(times: number): void {
    this.cool();
    for (let i = 0; i < times; i += 1) this.send({ kind: 'hint.request' }, 1000);
  }

  def(text: string): void {
    this.send({ kind: 'def.submit', lineId: this.nextLineId(), text }, 1000);
  }

  cardOpen(): void {
    this.send({ kind: 'card.open' }, 1000);
  }

  cardAnswer(choice: number): void {
    this.send({ kind: 'card.answer', choice }, 1000);
  }

  frameTemplate(): void {
    this.send({ kind: 'frame.template' }, 1000);
  }

  frame(text: string): void {
    this.send({ kind: 'frame.submit', lineId: this.nextLineId(), text }, 1000);
  }

  line(s: string, j: string, provenance: 'keyboard' | 'ink' = 'keyboard'): void {
    this.send({ kind: 'line.submit', lineId: this.nextLineId(), s, j, provenance }, 1000);
  }

  finish(): void {
    this.send({ kind: 'finish.try' }, 1000);
  }

  selfcheck(answers: readonly string[]): void {
    this.send({ kind: 'selfcheck.submit', answers }, 1000);
  }

  transfer(): void {
    this.send({ kind: 'transfer.complete' }, 1000);
  }

  summary(answers: readonly string[]): void {
    this.send({ kind: 'summary.submit', answers }, 1000);
  }

  skip(): void {
    this.send({ kind: 'layer.skip', reason: 'self' }, 1000);
  }

  flag(): void {
    this.send({ kind: 'flag.teacher', flagId: uuidOf(999) }, 1000);
  }
}
