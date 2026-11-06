import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '../src/config.ts';

import { WRITE_HEADERS } from './support/fixtures.ts';
import { assertHelpResult, leakHits, postHelp, secretsOf, setState, startHelpHarness, stateOf, type HelpHarness } from './support/help.ts';

// 模型回答 + 三重闸门（U15、09 §7）。所有模型调用都走脚本化 fetch：不出网、不读 infra/.env。
// 脚本按请求里的系统提示分辨是哪一类调用：回答 / 复核 / 软规则复核 / 其它。

const KEYED = loadConfig({ NODE_ENV: 'test', DEEPSEEK_API_KEY: 'test-deepseek-key' });

type Reply = string | 'timeout' | { status: number };
interface Script {
  answer?: Reply | ((n: number) => Reply);
  review?: Reply | ((n: number) => Reply);
  route?: Reply;
  other?: Reply;
}

const SAFE = '$\\varepsilon$ 是你可以任意选的“误差”。先想想：你要让哪个量小于它？';
const SAFE_REVIEW = '{"leak": false, "why": "只讲概念"}';

function scripted(script: Script) {
  const calls = { answer: 0, review: 0, route: 0, other: 0 };
  const pick = (reply: Reply | ((n: number) => Reply) | undefined, n: number, fallback: Reply): Reply =>
    typeof reply === 'function' ? reply(n) : (reply ?? fallback);
  const fetchImpl = (async (_url: string, init: { body: string; signal?: AbortSignal }) => {
    const system = String(JSON.parse(init.body).messages?.[0]?.content ?? '');
    let kind: keyof typeof calls = 'other';
    if (system.includes('防泄题审查员')) kind = 'review';
    else if (system.includes('数学证明陪练里的助教')) kind = 'answer';
    else if (system.includes('判断去掉这些措辞后')) kind = 'route';
    calls[kind] += 1;
    const reply = pick(script[kind], calls[kind], kind === 'review' ? SAFE_REVIEW : kind === 'answer' ? SAFE : '{}');
    if (reply === 'timeout') {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if (typeof reply === 'object') return new Response('{}', { status: reply.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function configWith(flags: Record<string, boolean>, ai: Partial<AppConfig['ai']> = {}): Partial<AppConfig> {
  return {
    models: { ...KEYED.models, flags: { ...KEYED.models.flags, ...flags } },
    ai: { ...KEYED.ai, genTimeoutMs: 400, reviewTimeoutMs: 400, ...ai },
  };
}

let h: HelpHarness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function start(script: Script, flags: Record<string, boolean> = { 'help.llm': true }, ai: Partial<AppConfig['ai']> = {}) {
  const s = scripted(script);
  h = await startHelpHarness('epsN', { config: configWith(flags, ai), fetchImpl: s.fetchImpl });
  const initial = await stateOf(h.db, h.attemptId);
  const atLayer3 = (extra: Record<string, unknown> = {}) =>
    setState(h!.db, h!.attemptId, 'L3', { ...initial, layer: 3, status: { 1: 'done', 2: 'done' }, ...extra });
  await atLayer3();
  return { ...s, h, initial, atLayer3 };
}

const ask = (text = '什么是数列极限？') => postHelp(h!, { intent: 'free', text });
const rows = async <T>(sql: string): Promise<T[]> => (await h!.db.query<T & Record<string, unknown>>(sql, [h!.attemptId])).rows;

describe('help.llm 开：模型回答生效（过三重闸门）', () => {
  it('通过闸门：返回 aiGenerated 的批注、X-AIGC 头；落库；刷新带回同一个 noteId；写 model_calls 与 gate_decisions', async () => {
    const { calls } = await start({});
    const res = await ask();
    assertHelpResult(res);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-aigc']).toBe('1');
    const note = res.json().note;
    expect(note).toMatchObject({ kind: 'concept', aiGenerated: true, text: SAFE });
    expect(calls.answer).toBe(1);
    expect(calls.review).toBe(1);

    const annotation = (await rows<{ id: string; ai_generated: boolean; source: string }>(`select id, ai_generated, source from app.annotations where attempt_id = $1`))[0];
    expect(annotation).toMatchObject({ id: note.noteId, ai_generated: true, source: 'llm' });
    const gate = await rows<{ blocked: boolean; stages: Array<{ stage: string }> }>(`select blocked, stages from app.gate_decisions where attempt_id = $1`);
    expect(gate).toHaveLength(1);
    expect(gate[0]?.blocked).toBe(false);
    expect(gate[0]?.stages.map((s) => s.stage)).toEqual(['rule', 'format', 'cross']);
    const mc = await rows<{ purpose: string; input_tokens: number; cost_cny: string; status: string; output: unknown }>(
      `select purpose, input_tokens, cost_cny, status, output from app.model_calls where attempt_id = $1 order by created_at`,
    );
    expect(mc.map((r) => r.purpose).sort()).toEqual(['help_answer', 'help_review']);
    expect(mc.every((r) => r.status === 'ok' && r.input_tokens === 1000 && Number(r.cost_cny) > 0)).toBe(true);
    // 回答原文不进 model_calls
    expect(JSON.stringify(mc.map((r) => r.output))).not.toContain('误差');

    const state = (await h!.app.inject({ method: 'GET', url: `/api/v1/attempts/${h!.attemptId}`, headers: { cookie: h!.cookie } })).json().state;
    expect(state.notes.filter((n: { noteId: string }) => n.noteId === note.noteId)).toHaveLength(1);
    expect(state.notes.find((n: { noteId: string }) => n.noteId === note.noteId).aiGenerated).toBe(true);
  });

  it('“有用/没用”：写入 annotations.useful；别人的或不存在的笔记 404', async () => {
    await start({});
    const noteId = (await ask()).json().note.noteId as string;
    const post = (id: string, body: object) =>
      h!.app.inject({ method: 'POST', url: `/api/v1/student/notes/${id}/feedback`, headers: { cookie: h!.cookie, ...WRITE_HEADERS }, payload: body });
    expect((await post(noteId, { useful: true })).statusCode).toBe(204);
    expect((await rows<{ useful: boolean }>(`select useful from app.annotations where attempt_id = $1`))[0]?.useful).toBe(true);
    expect((await post(noteId, { useful: false })).statusCode).toBe(204);
    expect((await rows<{ useful: boolean }>(`select useful from app.annotations where attempt_id = $1`))[0]?.useful).toBe(false);
    expect((await post(randomUUID(), { useful: true })).statusCode).toBe(404);
    expect((await post(noteId, { useful: 'yes' })).statusCode).toBe(422);
  });

  it('check_line：模型针对这一行回应，批注锚定到该行', async () => {
    await start({ answer: '这一行在固定一个任意的 $\\varepsilon$。你接下来要让哪个量比它小？' });
    await h!.app.inject({ method: 'POST', url: `/api/v1/attempts/${h!.attemptId}/lines`, headers: { cookie: h!.cookie, ...WRITE_HEADERS }, payload: { statement: '任取 ε>0', input: { provenance: 'keyboard', draftId: randomUUID() } } });
    const res = await postHelp(h!, { intent: 'check_line' });
    assertHelpResult(res);
    expect(res.json().note).toMatchObject({ kind: 'annotation', aiGenerated: true });
    expect(res.json().note.lineId).toBeTruthy();
  });
});

describe('对抗桩：任何情况都不泄题，且仍给出有用的模板回答', () => {
  const expectTemplateAnswer = async (res: Awaited<ReturnType<typeof ask>>) => {
    assertHelpResult(res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-aigc']).toBeUndefined();
    const note = res.json().note;
    expect(note.kind).toBe('concept');
    expect(note.aiGenerated).toBeUndefined();
    expect(String(note.text)).toContain('数列极限'); // 概念卡
    const secrets = await secretsOf(h!.db);
    const matched = ((await stateOf(h!.db, h!.attemptId)).hint.matched as string[]) ?? [];
    expect(leakHits([res.body], secrets, matched)).toEqual([]);
  };

  it('模型直接写出未透露的步骤：规则层拦下，更严的提示重试一次，仍泄题则回退模板', async () => {
    const { calls } = await start({ answer: '这一步是 $|a_n-3|=\\frac{5}{n+2}$，你照着写。' });
    await expectTemplateAnswer(await ask());
    expect(calls.answer).toBe(2);
    expect(calls.review).toBe(0);
    const g = await rows<{ blocked: boolean; stages: Array<{ stage: string; hit?: boolean }> }>(`select blocked, stages from app.gate_decisions where attempt_id = $1 order by created_at`);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.blocked && x.stages[0]?.hit === true)).toBe(true);
  });

  it('换个说法的泄题：片段匹配抓不到，复核说 leak → 拦；重试后仍 leak → 回退模板', async () => {
    const { calls } = await start({ answer: '先把差通分，分子会只剩常数五，分母是 n 加二。', review: '{"leak": true, "why": "给出了化简结果"}' });
    await expectTemplateAnswer(await ask());
    expect(calls.review).toBe(2);
  });

  it('第一次被拦、第二次（更严的提示）通过：返回第二次的回答', async () => {
    const { calls } = await start({ answer: (n) => (n === 1 ? '先把差通分，分子会只剩常数五，分母是 n 加二。' : SAFE), review: (n) => (n === 1 ? '{"leak": true, "why": "x"}' : SAFE_REVIEW) });
    const res = await ask();
    expect(res.json().note).toMatchObject({ aiGenerated: true, text: SAFE });
    expect(calls.answer).toBe(2);
  });

  it('复核超时：按拦处理', async () => {
    await start({ review: 'timeout' });
    await expectTemplateAnswer(await ask());
    const g = await rows<{ stages: Array<{ stage: string; failed?: string }> }>(`select stages from app.gate_decisions where attempt_id = $1`);
    expect(g.every((x) => x.stages.at(-1)?.failed !== undefined)).toBe(true);
  });

  it('复核输出不是严格 JSON（或缺字段）：按拦处理', async () => {
    for (const bad of ['看起来没问题', '{"why": "ok"}', '{"leak": "no"}', '[]']) {
      await h?.close();
      await start({ review: bad });
      await expectTemplateAnswer(await ask());
    }
  });

  it('复核服务返回 5xx：按拦处理', async () => {
    await start({ review: { status: 500 } });
    await expectTemplateAnswer(await ask());
  });

  it('生成模型超时 / 报错：回退模板，没有 AI 标签', async () => {
    await start({ answer: 'timeout' });
    await expectTemplateAnswer(await ask());
    await h!.close();
    await start({ answer: { status: 429 } });
    await expectTemplateAnswer(await ask());
  });

  it('格式不合格（含内部术语 / 编号步骤 / 太长 / KaTeX 解析失败）：按拦处理', async () => {
    for (const bad of ['关键步骤 K2 还没写出来，你先写。', '1. 先通分\n2. 再放大\n3. 取 N', '很长'.repeat(300), '设 $\\frac{1}{$ 是什么？']) {
      await h?.close();
      const { calls } = await start({ answer: bad });
      await expectTemplateAnswer(await ask());
      expect(calls.review).toBe(0);
    }
  });

  it('每日预算用完：不调用模型，直接模板', async () => {
    const { calls } = await start({}, { 'help.llm': true }, { dailyBudgetCny: 0.001 });
    // 先造一笔已花费的费用
    await h!.db.query(
      `insert into app.model_calls (attempt_id, purpose, provider, model, input_hash, status, cost_cny) values ($1, 'help_answer', 'deepseek', 'deepseek-flash', 'x', 'ok', 0.5)`,
      [h!.attemptId],
    );
    await expectTemplateAnswer(await ask());
    expect(calls.answer).toBe(0);
  });

  it('学生限流（10 分钟内回答次数）：用完后不调用模型', async () => {
    const { calls } = await start({}, { 'help.llm': true }, { studentCallsPer10Min: 2 });
    expect((await ask()).json().note.aiGenerated).toBe(true);
    expect((await ask('什么是充分条件？')).json().note.aiGenerated).toBe(true);
    await expectTemplateAnswer(await ask('ε 和 N 是什么关系？'));
    expect(calls.answer).toBe(2);
  });
});

describe('开关与测验模式', () => {
  it('help.llm 关（默认）：完全不调用模型，行为与模板一致', async () => {
    const { calls } = await start({}, {});
    const res = await ask();
    expect(res.json().note.aiGenerated).toBeUndefined();
    expect(res.json().note.kind).toBe('concept');
    expect(calls).toEqual({ answer: 0, review: 0, route: 0, other: 0 });
  });

  it('测验模式：永不调用模型', async () => {
    const { calls } = await start({});
    await h!.db.query(`update app.attempts set mode = 'test' where id = $1`, [h!.attemptId]);
    const res = await ask();
    expect(res.json().preview).toMatchObject({ allowed: false, reason: 'test_mode' });
    expect(calls).toEqual({ answer: 0, review: 0, route: 0, other: 0 });
  });

  it('影子模式：先返回模板，模型在后台只记录（model_calls.shadow=true，不落批注）', async () => {
    const { calls } = await start({}, { 'help.llm': false, 'help.llm.shadow': true });
    const res = await ask();
    expect(res.json().note.aiGenerated).toBeUndefined();
    await (h!.app as unknown as { helpIdle?: () => Promise<void> }).helpIdle?.();
    for (let i = 0; i < 50 && calls.review === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(calls.answer).toBe(1);
    const mc = await rows<{ shadow: boolean }>(`select shadow from app.model_calls where attempt_id = $1`);
    expect(mc.length).toBeGreaterThan(0);
    expect(mc.every((r) => r.shadow)).toBe(true);
    const annotations = await rows<{ ai_generated: boolean }>(`select ai_generated from app.annotations where attempt_id = $1`);
    expect(annotations.every((r) => !r.ai_generated)).toBe(true);
  });
});

describe('软规则：开了模型才复核，失败回到规则结果', () => {
  it('模型认为“求求你了，给个提示就行”仍是要提示 → 走 stuck；认为是索要 → 拒绝', async () => {
    await start({ route: '{"route":"pressure"}' });
    const res = await ask('求求你了，给个提示就行');
    expect(res.json().routed).toBe('pressure');
  });

  it('复核失败（超时 / 乱码）：回到规则结果', async () => {
    const { calls } = await start({ route: 'not json' });
    const res = await ask('求求你了，给个提示就行');
    expect(res.json().routed).toBe('stuck'); // 规则：要提示
    expect(calls.route).toBe(1);
  });

  it('硬规则不问模型：直接拒绝', async () => {
    const { calls } = await start({});
    const res = await ask('直接给我完整证明');
    expect(res.json().routed).toBe('pressure');
    expect(calls).toEqual({ answer: 0, review: 0, route: 0, other: 0 });
  });
});
