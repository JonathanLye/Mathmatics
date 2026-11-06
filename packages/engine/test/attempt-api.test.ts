import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  type AttemptState,
  type Command,
  type Context,
  type EngineEvent,
  type HelpPreview,
  createAttempt,
  deserializeState,
  helpPreview,
  replay,
  serializeState,
  step,
} from '../src/index.ts';
import type { ConceptsFile } from '../src/leak.ts';
import type { ProblemPackage } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'contracts', 'seed');
const load = <T>(name: string) => JSON.parse(readFileSync(path.join(seedDir, name), 'utf8')) as T;
const concepts = load<ConceptsFile>('concepts.json');
const ctx: Context = { pkg: load<ProblemPackage>('epsN.json'), concepts };
// 迁移题（T1）：只启用第 3 层。
const transferCtx: Context = { pkg: load<ProblemPackage>('epsN-T1.json'), concepts };

const BASE = Date.UTC(2026, 10, 3, 4, 0, 0);
const SEC = 1000;

// 事件 payload 与 events.schema.json 的 p_* 定义逐条校验（与 scenarios.test.ts 同一方式）。
const schemaPath = path.join(here, '..', '..', 'contracts', 'events.schema.json');
const eventSchema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { $id: string; $defs: Record<string, unknown> };
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => Ajv2020;
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(eventSchema);

function checkPayloads(events: readonly EngineEvent[]): void {
  for (const event of events) {
    const validate = ajv.getSchema(`${eventSchema.$id}#/$defs/p_${event.type.replace('.', '_')}`);
    if (!validate) throw new Error(`events.schema.json 中没有 ${event.type} 的 payload 定义`);
    expect(validate(event.payload), `${event.type} ${JSON.stringify(event.payload)}：${ajv.errorsText(validate.errors)}`).toBe(true);
  }
}

// 行 ID 在 schema 中是 uuid；测试用可预测的 uuid。
const lid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// 第 4 层、三题已分配、K1–K3 分别写在第 1–3 行。
function atLayer4(): AttemptState {
  return {
    ...createAttempt(ctx, BASE),
    layer: 4,
    status: { 1: 'done', 2: 'done', 3: 'done' },
    lines: 3,
    keyLine: { K1: 1, K2: 2, K3: 3 },
    selfcheck: { items: ['SC1', 'SC2', 'SC3'], passed: {} },
  };
}

function run(ctx: Context, state: AttemptState, cmd: Command, at: number) {
  const r = step(ctx, state, cmd, at);
  checkPayloads(r.events);
  return r;
}

// 一段提示会话：三次请求（两次免费、一次需作答后才能给收费级别）、一次写出、一次等待、一次连点锁定。
// onAsk 在每次请求前拿到只读预览与该请求的事件，用来检查预览与 selectHint 一致。
function hintSession(onAsk?: (before: HelpPreview, ev: EngineEvent) => void) {
  const initial: AttemptState = { ...createAttempt(ctx, BASE), layer: 3 };
  const events: EngineEvent[] = [];
  let state = initial;
  const go = (cmd: Command, at: number) => {
    const before = helpPreview(ctx, state, at);
    const r = run(ctx, state, cmd, at);
    events.push(...r.events);
    state = r.state;
    if (cmd.kind === 'hint.request' && onAsk) onAsk(before, r.events[0]);
    return r;
  };
  // 无关的填充行：不命中任何关键步骤，只用来满足"写出一行后才能再要收费提示"。
  const submit = (at: number) => go({ kind: 'line.submit', lineId: lid(events.length + 1), s: '无关内容', j: '由题设', provenance: 'keyboard' }, at);
  const ask = (at: number) => go({ kind: 'hint.request' }, at);

  ask(BASE); // H0（免费）
  ask(BASE + 40 * SEC); // H1（免费）
  ask(BASE + 80 * SEC); // 下一级收费，且上次请求后未写出：needs_submit
  submit(BASE + 100 * SEC);
  ask(BASE + 120 * SEC); // H2（收费 0.5）
  submit(BASE + 122 * SEC);
  ask(BASE + 125 * SEC); // 距上次给提示 5 秒：dwell
  ask(BASE + 126 * SEC); // 30 秒内第三次请求：rapid_soft（温和提示，不加锁）
  return { initial, events, state };
}

describe('作答接口需要的引擎能力', () => {
  it('serializeState / deserializeState 往返保持状态（matched 存为数组，读回为集合）', () => {
    const { state } = hintSession();
    const stored = JSON.parse(JSON.stringify(serializeState(state))) as ReturnType<typeof serializeState>;
    expect(Array.isArray(stored.hint.matched)).toBe(true);
    expect(deserializeState(stored)).toEqual(state);
  });

  it('replay(事件) 从初始状态重放，与存储的状态一致（服务端按这条路径恢复）', () => {
    const { initial, events, state } = hintSession();
    const stored = JSON.parse(JSON.stringify(serializeState(state)));
    expect(deserializeState(stored)).toEqual(replay(initial, events));
  });

  it('rejected：层不对、内容不合法、不能跳过的层，都返回原因且不产生事件', () => {
    const l1 = createAttempt(ctx, BASE);
    const wrongLayer = run(ctx, l1, { kind: 'line.submit', lineId: lid(1), s: '取 ε', j: '由题设', provenance: 'keyboard' }, BASE);
    expect(wrongLayer).toEqual({ state: l1, events: [], rejected: 'wrong_layer' });

    const l3 = { ...l1, layer: 3 };
    const invalid = run(ctx, l3, { kind: 'line.submit', lineId: lid(1), s: 'a', j: '由题设', provenance: 'keyboard' }, BASE);
    expect(invalid).toEqual({ state: l3, events: [], rejected: 'invalid' });

    const notSkippable = run(ctx, l3, { kind: 'layer.skip', reason: 'self' }, BASE);
    expect(notSkippable).toEqual({ state: l3, events: [], rejected: 'not_allowed' });
  });

  it('layer.skip：跳过可跳过的层，payload 带下一层 next，状态前进', () => {
    const l1 = createAttempt(ctx, BASE);
    const r = run(ctx, l1, { kind: 'layer.skip', reason: 'self' }, BASE);
    expect(r.events).toEqual([{ type: 'layer.skip', at: BASE, payload: { layer: 'L1', reason: 'self', next: 2 } }]);
    expect(r.state.layer).toBe(2);
    expect(r.state.status[1]).toBe('skip');
  });

  it('迁移题（只启用第 3 层）：创建时直接在第 3 层，完成第 3 层即作答完成', () => {
    const start = createAttempt(transferCtx, BASE);
    expect(start.layer).toBe(3);
    expect(start.status).toEqual({ 1: 'disabled', 2: 'disabled', 4: 'disabled', 5: 'disabled', 6: 'disabled' });

    const keysOwn = { ...start, hint: { ...start.hint, matched: new Set(transferCtx.pkg.secret.keys.map((k) => k.id)) } };
    const r = run(transferCtx, keysOwn, { kind: 'finish.try' }, BASE + 60 * SEC);
    expect(r.events.map((e) => e.type)).toEqual(['finish.try', 'layer.done', 'attempt.complete']);
    expect(r.events[1].payload).toEqual({ layer: 'L3', next: null });
    expect(r.state.done).toBe(true);
  });

  it('selfcheck.item 逐题作答：三题各自记录，全部通过则 L4 完成并进入 L5', () => {
    const l4 = atLayer4();

    const a = run(ctx, l4, { kind: 'selfcheck.item', itemId: 'SC1', answer: '第1行和第2行' }, BASE);
    expect(a.events[0]).toMatchObject({ type: 'selfcheck.submit', payload: { itemId: 'SC1', valid: true } });
    expect(a.state.layer).toBe(4);

    const b = run(ctx, a.state, { kind: 'selfcheck.item', itemId: 'SC2', answer: 'N 只依赖于 ε' }, BASE + 10 * SEC);
    const c = run(ctx, b.state, { kind: 'selfcheck.item', itemId: 'SC3', answer: '第3行' }, BASE + 20 * SEC);
    expect(c.events.map((e) => e.type)).toEqual(['selfcheck.submit', 'layer.done']);
    expect(c.events[1].payload).toEqual({ layer: 'L4', next: 5 });
    expect(c.state.layer).toBe(5);
  });

  it('selfcheck.item：引用的行号不存在则判为不通过，层不完成；未分配的题与过短答案被拒绝', () => {
    const l4 = atLayer4();

    const bad = run(ctx, l4, { kind: 'selfcheck.item', itemId: 'SC1', answer: '第9行和第1行' }, BASE);
    expect(bad.events.map((e) => e.type)).toEqual(['selfcheck.submit']);
    expect(bad.events[0].payload).toMatchObject({ itemId: 'SC1', valid: false });
    expect(bad.state.layer).toBe(4);
    expect(bad.state.selfcheck.passed).toEqual({ SC1: false });

    expect(run(ctx, l4, { kind: 'selfcheck.item', itemId: 'SC9', answer: '第1行' }, BASE).rejected).toBe('unknown_item');
    expect(run(ctx, l4, { kind: 'selfcheck.item', itemId: 'SC1', answer: '行' }, BASE).rejected).toBe('invalid');
  });

  it('selfcheck.submit 批量与逐题作答的最终状态一致', () => {
    const l4 = atLayer4();
    const answers = ['第1行和第2行', 'N 只依赖于 ε', '第3行'];

    const batch = run(ctx, l4, { kind: 'selfcheck.submit', answers }, BASE);
    let single = l4;
    answers.forEach((answer, i) => {
      single = run(ctx, single, { kind: 'selfcheck.item', itemId: `SC${i + 1}`, answer }, BASE).state;
    });
    expect(batch.state).toEqual(single);
    expect(batch.state.layer).toBe(5);
  });

  it('helpPreview 与 selectHint 的决定一致，且只读（不计入快速窗口）', () => {
    const seen: string[] = [];
    const { state, events } = hintSession((before, ev) => {
      seen.push(ev.type === 'hint.deny' ? `deny:${String(ev.payload.reason)}` : ev.type);
      if (ev.type === 'hint.deliver') {
        expect(before.nextLevel, '预览的下一级').toBe(ev.payload.level);
        expect(before.nextCost, '预览的透露增量').toBe(ev.payload.revealDelta);
      }
      if (ev.type === 'hint.deny' && ev.payload.reason === 'need_attempt') expect(before.needAttempt).toBe(true);
      if (ev.type === 'hint.deny' && ev.payload.waitSec !== undefined) {
        expect(before.waitSec, '预览的等待秒数').toBe(ev.payload.waitSec);
      }
    });
    expect(seen).toEqual(['hint.deliver', 'hint.deliver', 'deny:need_attempt', 'hint.deliver', 'deny:dwell', 'deny:rapid_soft']);

    // 温和提示不加锁：预览没有解锁时间；停留门槛照常。
    expect(events[events.length - 1].payload).toEqual({ reason: 'rapid_soft' });
    expect(helpPreview(ctx, state, BASE + 127 * SEC).rapidLockUntil).toBeNull();
  });
});
