import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type AttemptState,
  type Command,
  type Context,
  type EngineEvent,
  createAttempt,
  independenceOf,
  replay,
  serializeState,
  step,
} from '../src/index.ts';
import type { ConceptsFile } from '../src/leak.ts';
import type { ProblemPackage } from '../src/types.ts';

import { Runner } from './support/runner.ts';
import { DEF_OK, FRAME_TEXT, K1, K2, K3, K4, SCENARIOS, SELF_ANSWERS, SUMMARY_OK } from './support/scenarios.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const load = <T>(file: string): T => JSON.parse(readFileSync(path.join(seedDir, file), 'utf8')) as T;
const ctx: Context = { pkg: load<ProblemPackage>('epsN.json'), concepts: load<ConceptsFile>('concepts.json') };

// v3 的"需要不断指点"学生：走到第 25 步，K3 的 H2 触发额度用尽（reveal 2/2）
function exhaustedRunner(): Runner {
  const r = new Runner(ctx);
  for (const action of SCENARIOS.weak.slice(0, 25)) action(r);
  return r;
}

function run(state: AttemptState, cmd: Command, at: number): { state: AttemptState; events: EngineEvent[]; rejected?: string } {
  return step(ctx, state, cmd, at);
}

describe('软着陆：教师补发 H4（05 §4、12 §7 第 5 项）', () => {
  it('额度没用完：不允许补发（额度耗尽是唯一出口）', () => {
    const r = new Runner(ctx);
    r.def(DEF_OK);
    r.frame(FRAME_TEXT);
    r.line(...K1);
    const out = run(r.state, { kind: 'teacher.grant_h4' }, r.t + 1000);
    expect(out.rejected).toBe('not_allowed');
    expect(out.events).toEqual([]);
  });

  it('额度用尽后补发：hint.deliver{override:true, revealDelta:0}，reveal 不变，不进快速窗口，记 overrides', () => {
    const r = exhaustedRunner();
    expect(r.state.hint.exhausted).toBe(true);
    const before = r.state;
    const out = run(before, { kind: 'teacher.grant_h4' }, r.t + 5000);
    expect(out.rejected).toBeUndefined();
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({
      type: 'hint.deliver',
      payload: { hintId: 'K3.H4', key: 'K3', level: 'H4', revealDelta: 0, revealAfter: before.hint.reveal, override: true },
    });
    expect(out.state.hint.reveal).toBe(before.hint.reveal);
    expect(out.state.hint.hintTimes).toEqual(before.hint.hintTimes);
    expect(out.state.hint.lastHintAt).toBe(before.hint.lastHintAt);
    expect(out.state.overrides).toEqual(['K3']);
    expect(out.state.viaHint).toContain('K3');
    // 同一步不能补发第二次
    expect(run(out.state, { kind: 'teacher.grant_h4', key: 'K3' }, r.t + 6000).rejected).toBe('invalid');
    // 指定一个不存在的步骤
    expect(run(before, { kind: 'teacher.grant_h4', key: 'K99' }, r.t + 6000).rejected).toBe('invalid');
  });

  it('补发之后：没有依据（<6 字）不计入；补上依据才计入；完成时 attempt.complete 带 teacherOverrides，独立度按补发计入', () => {
    const r = exhaustedRunner();
    const events: EngineEvent[] = [...r.events];
    let state = r.state;
    let t = r.t;
    const send = (cmd: Command): EngineEvent[] => {
      t += 1000;
      const out = run(state, cmd, t);
      expect(out.rejected, JSON.stringify(cmd)).toBeUndefined();
      state = out.state;
      events.push(...out.events);
      return out.events;
    };
    send({ kind: 'teacher.grant_h4' });

    // 写出 K3 但依据只有 3 个字 → 示范行，不计入
    const demo = send({ kind: 'line.submit', lineId: '00000000-0000-4000-8000-000000000101', s: K3[0], j: '照抄的', provenance: 'keyboard' });
    expect(demo[0]).toMatchObject({ type: 'line.submit', payload: { cls: 'demo_needs_reason', newKeys: [] } });
    expect(state.hint.matched.has('K3')).toBe(false);
    // 补上 ≥6 字的依据 → 计入
    const ok = send({ kind: 'line.submit', lineId: '00000000-0000-4000-8000-000000000102', s: K3[0], j: K3[1], provenance: 'keyboard' });
    expect(ok[0]).toMatchObject({ type: 'line.submit', payload: { cls: 'match', newKeys: ['K3'] } });
    send({ kind: 'line.submit', lineId: '00000000-0000-4000-8000-000000000103', s: K4[0], j: K4[1], provenance: 'keyboard' });
    expect(events.filter((e) => e.type === 'hint.deliver' && e.payload.override === true)).toHaveLength(1);

    // 完成判据闭合，一路到完成
    send({ kind: 'finish.try' });
    send({ kind: 'selfcheck.submit', answers: SELF_ANSWERS });
    send({ kind: 'transfer.complete' });
    const done = send({ kind: 'summary.submit', answers: SUMMARY_OK });
    const complete = done.find((e) => e.type === 'attempt.complete');
    expect(complete?.payload).toMatchObject({ teacherOverrides: ['K3'], reveal: 2 });
    // reveal=2/keysTotal=4 本来是 0.5；补发的 H4 再按 1 计入 → 0.25
    expect(complete?.payload.independence).toBe(0.25);
    expect(independenceOf(state, 4)).toBe(0.25);

    // 回放：同一串事件重建出同一个终态（逐字段）
    const initial = createAttempt(ctx, r.state.start);
    expect(serializeState(replay(initial, events))).toEqual(serializeState(state));
  });

  it('没有补发的作答：attempt.complete 不带 teacherOverrides，独立度公式不变', () => {
    const r = new Runner(ctx);
    for (const action of SCENARIOS.pro.slice(0, 11)) action(r);
    const complete = r.events.find((e) => e.type === 'attempt.complete');
    expect(complete?.payload).not.toHaveProperty('teacherOverrides');
    expect(complete?.payload.independence).toBe(1);
    expect(K2.length).toBe(2); // 使用导入，避免未使用告警
  });
});
