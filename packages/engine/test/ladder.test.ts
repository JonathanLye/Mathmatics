import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createAttempt, helpPreview, replay, serializeState, deserializeState, step } from '../src/index.ts';
import type { AttemptState, Command, Context, EngineEvent } from '../src/index.ts';
import type { ConceptsFile } from '../src/leak.ts';
import type { ProblemPackage } from '../src/types.ts';

import { K1, K2, K3 } from './support/scenarios.ts';
import { BASE, uuidOf } from './support/runner.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const load = <T>(file: string): T => JSON.parse(readFileSync(path.join(seedDir, file), 'utf8')) as T;
const ctx: Context = { pkg: load<ProblemPackage>('epsN.json'), concepts: load<ConceptsFile>('concepts.json') };
const SEC = 1000;

const atL3 = (): AttemptState => ({ ...createAttempt(ctx, BASE), layer: 3, status: { 1: 'done', 2: 'done' } });

function run(state: AttemptState, cmd: Command, at: number) {
  const r = step(ctx, state, cmd, at);
  return { ...r, state: r.state };
}

function submit(state: AttemptState, n: number, text: readonly [string, string], at: number, modelKeys?: string[]) {
  return run(state, { kind: 'line.submit', lineId: uuidOf(n), s: text[0], j: text[1], provenance: 'keyboard', ...(modelKeys ? { modelKeys } : {}) }, at);
}

describe('卡住死胡同（U15）', () => {
  it('卡住满 stuckMs：H2 预览不再要求先写一行；没卡住仍要求', () => {
    const base = { ...atL3(), hint: { ...atL3().hint, hintLv: { K1: 2 }, submitsSinceHint: 0 } };
    expect(helpPreview(ctx, base, BASE + 100 * SEC).needAttempt).toBe(true);
    expect(helpPreview(ctx, base, BASE + 181 * SEC).needAttempt).toBe(false);
    const r = run(base, { kind: 'hint.request' }, BASE + 181 * SEC);
    expect(r.events.map((e) => e.type)).toEqual(['hint.deliver']);
    expect(r.state.hint.reveal).toBeCloseTo(0.5);
  });

  it('找老师：额度没用完且没卡住时拒绝；卡住满 stuckMs 后允许；只能找一次', () => {
    const s = atL3();
    expect(run(s, { kind: 'flag.teacher', flagId: uuidOf(1) }, BASE + 60 * SEC).rejected).toBe('not_allowed');
    const ok = run(s, { kind: 'flag.teacher', flagId: uuidOf(1) }, BASE + 181 * SEC);
    expect(ok.events.map((e) => e.type)).toEqual(['help.flag_teacher']);
    expect(run(ok.state, { kind: 'flag.teacher', flagId: uuidOf(2) }, BASE + 190 * SEC).rejected).toBe('not_allowed');
    expect(helpPreview(ctx, s, BASE + 181 * SEC).canFlag).toBe(true);
    expect(helpPreview(ctx, s, BASE + 60 * SEC).canFlag).toBe(false);
  });

  it('连续求助：第 3 次起温和提示，状态不变，没有锁、不扣额度', () => {
    let s = atL3();
    s = run(s, { kind: 'hint.request' }, BASE + 1 * SEC).state;
    s = run(s, { kind: 'hint.request' }, BASE + 2 * SEC).state;
    const third = run(s, { kind: 'hint.request' }, BASE + 3 * SEC);
    expect(third.events).toEqual([{ type: 'hint.deny', at: BASE + 3 * SEC, payload: { reason: 'rapid_soft' } }]);
    expect(third.state).toEqual(s);
    expect(third.state.hint.blockedUntil).toBeNull();
    expect(third.state.hint.reveal).toBe(s.hint.reveal);
  });
});

describe('模型兜底归类（matchedBy:model）', () => {
  const unknownLine: [string, string] = ['所以这个数列收敛', '由定义'];

  it('规则判 unknown、模型给出有效 ID：按模型的关键步骤计入，事件带 matchedBy，不动透露量', () => {
    const r = submit(atL3(), 1, unknownLine, BASE + SEC, ['K1']);
    const ev = r.events[0];
    expect(ev.payload).toMatchObject({ cls: 'match', keys: ['K1'], newKeys: ['K1'], path: 'llm', matchedBy: 'model' });
    expect([...r.state.hint.matched]).toEqual(['K1']);
    expect(r.state.hint.reveal).toBe(0);
    expect(r.state.hint.hintLv).toEqual({});
  });

  it('不存在的关键步骤 ID（过期或编造）一律丢弃：仍是 unknown', () => {
    const r = submit(atL3(), 1, unknownLine, BASE + SEC, ['K9', '__proto__']);
    expect(r.events[0].payload).toMatchObject({ cls: 'unknown', keys: [], newKeys: [] });
    expect(r.events[0].payload.matchedBy).toBeUndefined();
  });

  it('规则已经命中时不采用模型的结果；规则判为错误类型时同样不采用', () => {
    const hit = submit(atL3(), 1, K1, BASE + SEC, ['K3']);
    expect(hit.events[0].payload).toMatchObject({ keys: ['K1'], path: 'rule' });
    expect(hit.events[0].payload.matchedBy).toBeUndefined();
  });

  it('重放事件得到与实时一致的状态（模型结果已写进事件，重放不再调用模型）', () => {
    const a = submit(atL3(), 1, unknownLine, BASE + SEC, ['K1']);
    const b = submit(a.state, 2, K2, BASE + 2 * SEC);
    const events: EngineEvent[] = [...a.events, ...b.events];
    expect(replay(atL3(), events)).toEqual(b.state);
  });
});

describe('改行与删行（M15：matched 重算，reveal 永不减少）', () => {
  it('改行失去关键步骤：matched 去掉它；其它行仍持有的关键步骤保留；reveal 与阶梯不变', () => {
    const events: EngineEvent[] = [];
    const go = (r: ReturnType<typeof run>) => {
      events.push(...r.events);
      return r.state;
    };
    let s = atL3();
    s = go(run(s, { kind: 'hint.request' }, BASE + SEC));
    s = go(run(s, { kind: 'hint.request' }, BASE + 40 * SEC));
    const before = s;
    s = go(submit(s, 1, K1, BASE + 50 * SEC));
    s = go(submit(s, 2, K2, BASE + 51 * SEC));
    expect([...s.hint.matched].sort()).toEqual(['K1', 'K2']);

    const edit = run(
      s,
      { kind: 'line.edit', lineId: uuidOf(1), n: 1, s: '无关内容', j: '', field: 'statement', provenance: 'keyboard', oldKeys: ['K1'], otherKeys: ['K2'] },
      BASE + 60 * SEC,
    );
    expect(edit.events[0].payload).toMatchObject({ cls: 'unknown', keys: [], newKeys: [], lostKeys: ['K1'] });
    expect([...edit.state.hint.matched]).toEqual(['K2']);
    expect(edit.state.hint.reveal).toBe(before.hint.reveal);
    expect(edit.state.hint.hintLv).toEqual(s.hint.hintLv);
    expect(edit.state.hint.keyCost).toEqual(s.hint.keyCost);

    const del = run(edit.state, { kind: 'line.delete', lineId: uuidOf(2), oldKeys: ['K2'], otherKeys: [] }, BASE + 70 * SEC);
    expect(del.events[0].payload).toEqual({ lineId: uuidOf(2), lostKeys: ['K2'] });
    expect([...del.state.hint.matched]).toEqual([]);
    expect(del.state.hint.reveal).toBe(before.hint.reveal);
    expect(replay(atL3(), [...events, ...edit.events, ...del.events])).toEqual(del.state);
  });

  it('改成另一个关键步骤：newKeys 计入，lostKeys 去掉旧的', () => {
    let s = submit(atL3(), 1, K1, BASE + SEC).state;
    const edit = run(
      s,
      { kind: 'line.edit', lineId: uuidOf(1), n: 1, s: K3[0], j: K3[1], field: 'both', provenance: 'keyboard', oldKeys: ['K1'], otherKeys: [] },
      BASE + 2 * SEC,
    );
    expect(edit.events[0].payload).toMatchObject({ keys: ['K3'], newKeys: ['K3'], lostKeys: ['K1'] });
    s = edit.state;
    expect([...s.hint.matched]).toEqual(['K3']);
    expect(s.keyLine).toEqual({ K3: 1 });
  });

  it('不在第 3 层时拒绝', () => {
    const r = run(createAttempt(ctx, BASE), { kind: 'line.delete', lineId: uuidOf(1), oldKeys: [], otherKeys: [] }, BASE);
    expect(r.rejected).toBe('wrong_layer');
  });

  it('序列化往返后仍可继续改行', () => {
    const s = submit(atL3(), 1, K1, BASE + SEC).state;
    const again = deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
    expect(again.hint.matched.has('K1')).toBe(true);
  });
});

describe('切换层', () => {
  it('只能去已完成/跳过的层或最前沿；去前沿以外的层被拒绝', () => {
    const s = atL3();
    const back = run(s, { kind: 'layer.enter', layer: 1 }, BASE);
    expect(back.events[0]).toMatchObject({ type: 'layer.enter', payload: { from: 'L3', to: 1, via: 'nav' } });
    expect(back.state.layer).toBe(1);
    expect(run(back.state, { kind: 'layer.enter', layer: 3 }, BASE + SEC).state.layer).toBe(3);
    expect(run(s, { kind: 'layer.enter', layer: 5 }, BASE).rejected).toBe('not_allowed');
    expect(run(s, { kind: 'layer.enter', layer: 9 }, BASE).rejected).toBe('not_allowed');
  });

  it('回到已完成的层再提交，不会重复推进层', () => {
    const back = run(atL3(), { kind: 'layer.enter', layer: 1 }, BASE).state;
    const r = run(back, { kind: 'def.submit', lineId: uuidOf(1), text: '∀ε>0，∃N，∀n>N，|a_n−A|<ε' }, BASE + SEC);
    expect(r.events.some((e) => e.type === 'layer.done')).toBe(false);
  });
});
