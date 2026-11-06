import { randomUUID } from 'node:crypto';

import { apply, deserializeState, type EngineEvent, type SerializedAttemptState } from '@proof-gym/engine';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../src/config.ts';

import { WRITE_HEADERS } from './support/fixtures.ts';
import { setState, startHelpHarness, stateOf, type HelpHarness } from './support/help.ts';

// 模型参与的结构化判定：第 3 层兜底归类（matchedBy:model）和 L1/L2 语义判定。模型全部走脚本化 fetch。
const KEYED = loadConfig({ NODE_ENV: 'test', DASHSCOPE_API_KEY: 'test-dashscope-key' });

function scripted(reply: string | 'timeout' | { status: number }) {
  const state = { calls: 0 };
  const fetchImpl = (async (_url: string, init: { body: string; signal?: AbortSignal }) => {
    state.calls += 1;
    if (reply === 'timeout') return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    if (typeof reply === 'object') return new Response('{}', { status: reply.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 500, completion_tokens: 40 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, state };
}

const configWith = (flags: Record<string, boolean>): Partial<AppConfig> => ({
  models: { ...KEYED.models, flags: { ...KEYED.models.flags, ...flags } },
  ai: { ...KEYED.ai, classifyTimeoutMs: 300 },
});

let h: HelpHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function start(reply: Parameters<typeof scripted>[0], flags: Record<string, boolean>) {
  const s = scripted(reply);
  h = await startHelpHarness('epsN', { config: configWith(flags), fetchImpl: s.fetchImpl });
  const initial = await stateOf(h.db, h.attemptId);
  return { ...s, h, initial };
}

const post = (url: string, payload: object) =>
  h!.app.inject({ method: 'POST', url: `/api/v1/attempts/${h!.attemptId}${url}`, headers: { cookie: h!.cookie, ...WRITE_HEADERS }, payload });
const input = () => ({ provenance: 'keyboard', draftId: randomUUID() });
const eventsOf = async (type: string) =>
  (await h!.db.query<{ payload: Record<string, any> }>(`select payload from ev.events where attempt_id = $1 and type = $2 order by seq`, [h!.attemptId, type])).rows.map((r) => r.payload);

// 规则认不出的一行（没有任何关键步骤的写法），语义上是 K1：差的绝对值化简成只含 n 的分式。
const UNKNOWN_LINE = { statement: '计算差的绝对值，得到五除以 n 加二', justification: '通分', input: input() };

async function atLayer3(initial: Record<string, any>, extra: Record<string, unknown> = {}) {
  await setState(h!.db, h!.attemptId, 'L3', { ...initial, layer: 3, status: { 1: 'done', 2: 'done' }, ...extra });
}

describe('第 3 层兜底归类（llm.fallbackClassify）', () => {
  const FLAGS = { 'llm.fallbackClassify': true };
  const accept = '{"keyIds": ["K1"], "confidence": 0.93}';

  it('规则判 unknown、模型高置信给出 K1：计入 K1，事件记 matchedBy=model，透露量和提示阶梯不受影响', async () => {
    const { state, initial } = await start(accept, FLAGS);
    await atLayer3(initial);
    const before = await stateOf(h!.db, h!.attemptId);
    const res = await post('/lines', UNKNOWN_LINE);
    expect(res.statusCode, res.body).toBe(200);
    expect(state.calls).toBe(1);

    const after = await stateOf(h!.db, h!.attemptId);
    expect(after.hint.matched).toEqual(['K1']);
    expect(after.hint.reveal).toBe(before.hint.reveal);
    expect(after.hint.hintLv).toEqual(before.hint.hintLv);
    expect(after.hint.keyCost).toEqual(before.hint.keyCost);
    const [ev] = await eventsOf('line.submit');
    expect(ev).toMatchObject({ cls: 'match', keys: ['K1'], newKeys: ['K1'], path: 'llm', matchedBy: 'model' });
    const row = (await h!.db.query<{ classifier_path: string; cls: string }>(`select classifier_path, cls from app.attempt_lines where attempt_id = $1`, [h!.attemptId])).rows[0];
    expect(row).toEqual({ classifier_path: 'llm', cls: 'match' });
    // 模型不产生给学生看的文字：响应里没有新增批注
    expect(res.json().state.notes).toEqual([]);

    // 回放：事件 apply 到之前的状态，得到存下来的状态（重放不再调用模型）
    const replayed = apply(deserializeState(before as SerializedAttemptState), { type: 'line.submit', at: Date.now(), payload: ev } as EngineEvent);
    expect([...replayed.hint.matched]).toEqual(after.hint.matched);
    expect(replayed.keyLine).toEqual(after.keyLine);
  });

  it('计入之后，提示阶梯从下一个关键步骤开始；额度规则不变', async () => {
    const { initial } = await start(accept, FLAGS);
    await atLayer3(initial);
    await post('/lines', UNKNOWN_LINE);
    const help = await h!.app.inject({ method: 'POST', url: `/api/v1/attempts/${h!.attemptId}/help`, headers: { cookie: h!.cookie, ...WRITE_HEADERS }, payload: { intent: 'stuck' } });
    expect(help.json().note).toMatchObject({ kind: 'hint', level: 'H0' });
    expect((await eventsOf('hint.deliver'))[0]).toMatchObject({ key: 'K2' });
  });

  it('低置信（<0.8）、超时、5xx、非 JSON、不存在的关键步骤 ID：都保持 unknown', async () => {
    for (const reply of ['{"keyIds": ["K1"], "confidence": 0.79}', 'timeout', { status: 500 }, '看起来是第一步', '{"keyIds": ["K9"], "confidence": 0.99}', '{"keyIds": "K1", "confidence": 0.99}'] as const) {
      await h?.close();
      const { initial } = await start(reply, FLAGS);
      await atLayer3(initial);
      const res = await post('/lines', UNKNOWN_LINE);
      expect(res.statusCode, `${JSON.stringify(reply)} ${res.body}`).toBe(200);
      expect((await stateOf(h!.db, h!.attemptId)).hint.matched, JSON.stringify(reply)).toEqual([]);
      expect((await eventsOf('line.submit'))[0], JSON.stringify(reply)).toMatchObject({ cls: 'unknown', path: 'rule' });
    }
  });

  it('规则已经命中（或判为错误类型）时不问模型；开关关着也不问', async () => {
    const { state, initial } = await start(accept, FLAGS);
    await atLayer3(initial);
    await post('/lines', { statement: '|a_n−3| = 5/(n+2)', justification: '通分化简', input: input() });
    expect(state.calls).toBe(0);
    await h!.close();

    const off = await start(accept, {});
    await atLayer3(off.initial);
    await post('/lines', UNKNOWN_LINE);
    expect(off.state.calls).toBe(0);
  });

  it('测验模式也运行（它不产生给学生看的文字）', async () => {
    const { state, initial } = await start(accept, FLAGS);
    await h!.db.query(`update app.attempts set mode = 'test' where id = $1`, [h!.attemptId]);
    await atLayer3(initial);
    await post('/lines', UNKNOWN_LINE);
    expect(state.calls).toBe(1);
    expect((await stateOf(h!.db, h!.attemptId)).hint.matched).toEqual(['K1']);
  });

  it('改行同样走兜底：把一行改成语义上的 K1', async () => {
    const { initial } = await start(accept, FLAGS);
    await atLayer3(initial);
    // 先写一行规则和模型都认不出的：模型这次说“无”
    const added = await post('/lines', { statement: '先任取 ε', input: input() });
    const lineId = added.json().state.steps.lines[0].lineId as string;
    expect((await stateOf(h!.db, h!.attemptId)).hint.matched).toEqual(['K1']); // 脚本对所有调用都返回 K1
    const edited = await h!.app.inject({
      method: 'PATCH',
      url: `/api/v1/attempts/${h!.attemptId}/lines/${lineId}`,
      headers: { cookie: h!.cookie, ...WRITE_HEADERS },
      payload: { statement: '无关的话', input: input() },
    });
    expect(edited.statusCode, edited.body).toBe(200);
  });
});

describe('L1/L2 语义判定（help.llm）', () => {
  const FLAGS = { 'help.llm': true };
  const FAILING_DEF = '极限就是数列越来越接近某个数';

  it('规则不过、模型高置信判通过：第 1 层通过，事件 path=rule+llm', async () => {
    const { state } = await start('{"pass": true, "missing": [], "confidence": 0.92}', FLAGS);
    const res = await post('/definition', { text: FAILING_DEF, input: input() });
    expect(res.statusCode, res.body).toBe(200);
    expect(state.calls).toBe(1);
    expect(res.json().state.layers[0].status).toBe('done');
    expect((await eventsOf('def.submit'))[0]).toMatchObject({ pass: true, path: 'rule+llm' });
  });

  it('模型指出缺哪个成分：不通过，右栏出现“还缺：…”', async () => {
    await start('{"pass": false, "missing": ["exists_N", "bogus"], "confidence": 0.9}', FLAGS);
    const res = await post('/definition', { text: FAILING_DEF, input: input() });
    expect(res.json().state.layers[0].status).toBe('active');
    const notes = res.json().state.notes as Array<{ text: string; kind: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toBe('还缺：存在 N');
    expect((await eventsOf('def.submit'))[0]).toMatchObject({ pass: false, path: 'rule' });
  });

  it('低置信、超时、非 JSON、通过但又列出缺项：都按规则结果（不通过，没有批注）', async () => {
    for (const reply of ['{"pass": true, "missing": [], "confidence": 0.5}', 'timeout', 'pass', '{"pass": true, "missing": ["exists_N"], "confidence": 0.99}'] as const) {
      await h?.close();
      await start(reply, FLAGS);
      const res = await post('/definition', { text: FAILING_DEF, input: input() });
      expect(res.statusCode).toBe(200);
      expect(res.json().state.layers[0].status, String(reply)).toBe('active');
      expect(res.json().state.notes, String(reply)).toEqual([]);
    }
  });

  it('规则通过时不问模型；测验模式不问模型；开关关着不问', async () => {
    const pass = await start('{"pass": true, "missing": [], "confidence": 0.99}', FLAGS);
    await post('/definition', { text: '∀ε>0，∃N，∀n>N，|a_n−A|<ε', input: input() });
    expect(pass.state.calls).toBe(0);
    await h!.close();

    const test = await start('{"pass": true, "missing": [], "confidence": 0.99}', FLAGS);
    await h!.db.query(`update app.attempts set mode = 'test' where id = $1`, [h!.attemptId]);
    await post('/definition', { text: FAILING_DEF, input: input() });
    expect(test.state.calls).toBe(0);
    await h!.close();

    const off = await start('{"pass": true, "missing": [], "confidence": 0.99}', {});
    await post('/definition', { text: FAILING_DEF, input: input() });
    expect(off.state.calls).toBe(0);
  });

  it('第 2 层骨架：模型判通过则进入第 3 层；指出缺项则给出预写的“骨架里还缺：…”', async () => {
    const { initial } = await start('{"pass": true, "missing": [], "confidence": 0.9}', FLAGS);
    await setState(h!.db, h!.attemptId, 'L2', { ...initial, layer: 2, status: { 1: 'done' } });
    const ok = await post('/framework', { text: '先固定一个很小的误差，再去找位置', input: input() });
    expect(ok.json().state.currentLayer).toBe('L3');
    expect((await eventsOf('frame.submit'))[0]).toMatchObject({ pass: true, path: 'rule+llm' });
    await h!.close();

    const { initial: again } = await start('{"pass": false, "missing": ["F2"], "confidence": 0.9}', FLAGS);
    await setState(h!.db, h!.attemptId, 'L2', { ...again, layer: 2, status: { 1: 'done' } });
    const no = await post('/framework', { text: '先固定一个很小的误差', input: input() });
    expect(no.json().state.currentLayer).toBe('L2');
    expect((no.json().state.notes as Array<{ text: string }>)[0]?.text).toBe('骨架里还缺：中间——要构造一个 $N$。');
  });
});
