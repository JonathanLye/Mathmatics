// 聊天适配器（DashScope / DeepSeek 共用）与评测脚本的纯函数。全部用桩 fetch，不联网、不读密钥。
import { describe, expect, it } from 'vitest';

import { AdapterError } from '../src/ai/errors.ts';
import { formatProblem } from '../src/help/gate.ts';
import { buildChatRequest, invokeChat, parseChatResponse } from '../src/ai/chat.ts';
// @ts-expect-error 评测脚本是 .mjs，没有类型声明
import { percentile, stubFetch, summarize } from '../../../tools/help-eval.mjs';

const MESSAGES = [{ role: 'user' as const, content: '什么是数列极限？' }];

function okFetch(content: string, usage: Record<string, number> = { prompt_tokens: 12, completion_tokens: 7 }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), { status: 200 })) as unknown as typeof fetch;
}

function invoke(fetchImpl: typeof fetch, input: unknown = { messages: MESSAGES }, provider: 'dashscope' | 'deepseek' = 'dashscope') {
  return invokeChat({
    provider,
    baseUrl: 'https://llm.test/v1',
    apiKey: 'test-key-not-real',
    model: 'm',
    thinking: false,
    input,
    signal: AbortSignal.timeout(2000),
    fetchImpl,
  });
}

describe('聊天适配器', () => {
  it('请求体：qwen 关思考用 enable_thinking，DeepSeek 用 thinking.type；json 模式带 response_format', () => {
    const qwen = buildChatRequest({ provider: 'dashscope', model: 'q', thinking: false, input: { messages: MESSAGES, json: true } });
    expect(qwen.enable_thinking).toBe(false);
    expect(qwen.response_format).toEqual({ type: 'json_object' });
    const ds = buildChatRequest({ provider: 'deepseek', model: 'd', thinking: false, input: { messages: MESSAGES } });
    expect(ds.thinking).toEqual({ type: 'disabled' });
    expect(ds.response_format).toBeUndefined();
    expect(ds.enable_thinking).toBeUndefined();
  });

  it('正常响应：取文本与 token 用量', async () => {
    const out = await invoke(okFetch('  极限是……  '));
    expect(out.text).toBe('极限是……');
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
  });

  it('只抛原因码：非 2xx、网络错误、非 JSON、缺 choices、输入不合法', async () => {
    const status = (async () => new Response('secret body', { status: 503 })) as unknown as typeof fetch;
    await expect(invoke(status)).rejects.toMatchObject({ reason: 'http_503' });
    const net = (async () => {
      throw new Error('boom with student text');
    }) as unknown as typeof fetch;
    await expect(invoke(net)).rejects.toMatchObject({ reason: 'network' });
    const text = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    await expect(invoke(text)).rejects.toMatchObject({ reason: 'bad_response' });
    expect(() => parseChatResponse({ nope: 1 })).toThrow(AdapterError);
    await expect(invoke(okFetch('x'), { messages: [] })).rejects.toMatchObject({ reason: 'bad_input' });
    await expect(invoke(okFetch('x'), 'oops')).rejects.toMatchObject({ reason: 'bad_input' });
  });
});

describe('评测脚本（tools/help-eval.mjs）纯函数', () => {
  it('percentile 与 summarize：泄题数、误拒率、兜底误判率', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([], 95)).toBe(0);
    const summary = summarize({
      leaks: [],
      benign: [{ outcome: 'ai' }, { outcome: 'ai' }, { outcome: 'router_refusal' }, { outcome: 'gate_blocked' }],
      latencies: [100, 200, 300],
      costCny: 0.0123456789,
      lines: [
        { ruleUnknown: true, expect: [], got: ['K1'] },
        { ruleUnknown: true, expect: [], got: [] },
        { ruleUnknown: true, expect: ['K2'], got: ['K2'] },
        { ruleUnknown: false, expect: ['K1'], got: ['K1'] },
      ],
    });
    expect(summary.leakCount).toBe(0);
    expect(summary.benign.falseRefusalRate).toBe(0.5);
    expect(summary.pass).toBe(false);
    expect(summary.fallbackClassifier).toMatchObject({ evaluated: 3, expectNone: 2, falseMatches: 1, falseMatchRate: 0.5, credited: 1 });
    const leaky = summarize({ leaks: ['K3:x'], benign: [{ outcome: 'ai' }], latencies: [], costCny: 0, lines: [] });
    expect(leaky.pass).toBe(false);
    expect(summarize({ leaks: [], benign: [{ outcome: 'ai' }], latencies: [1], costCny: 0, lines: [] }).pass).toBe(true);
  });

  it('桩模型 --stub 的行为确定：复核说不泄题，生成给一句追问', async () => {
    const f = stubFetch();
    const review = await f('u', { body: JSON.stringify({ messages: [{ content: '你是防泄题审查员' }] }) });
    expect(JSON.parse(((await review.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content)).toEqual({
      leak: false,
      why: '概念性说明',
    });
  });
});

describe('格式层：公式个数', () => {
  const ok = () => true;
  it('单个符号（$N$、$\\varepsilon$、$a_n$）不算公式；整段推导（7 个以上真正的式子）才拦', () => {
    const symbols = '这里 $N$、$\\varepsilon$、$a_n$、$A$、$n$、$x$、$y$、$\\delta$ 都只是符号，用来说明量词的先后。';
    expect(formatProblem(symbols, ok)).toBeNull();
    const derivation = Array.from({ length: 7 }, (_, i) => `$f(${i})+${i}$`).join('，');
    expect(formatProblem(derivation, ok)).toBe('too_many_formulas');
  });
});
