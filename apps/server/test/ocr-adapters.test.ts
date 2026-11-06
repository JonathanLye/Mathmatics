import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildDashscopeRequest, invokeDashscope, parseDashscopeResponse, P_OCR_1 } from '../src/ai/dashscope.ts';
import { invokeSimpleTex, parseSimpleTexResponse, signSimpleTex } from '../src/ai/simpletex.ts';

const PNG_B64 = Buffer.from('not-a-real-png').toString('base64');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('SimpleTex 签名', () => {
  it('非文件字段 + timestamp/random-str/app-id 按 key 升序，末尾追加 secret，取 md5（对照官方文档示例的拼接规则）', () => {
    const expected = createHash('md5')
      .update('app-id=APPID&random-str=mSkYSY28N4WkvidB&timestamp=1675550577&use_batch=True&secret=SECRET')
      .digest('hex');
    const sign = signSimpleTex(
      { use_batch: 'True' },
      { appId: 'APPID', appSecret: 'SECRET', timestamp: '1675550577', randomStr: 'mSkYSY28N4WkvidB' },
    );
    expect(sign).toBe(expected);
  });

  it('请求头带 app-id/random-str/timestamp/sign，不带 secret；file 为 multipart', async () => {
    let seen: { url: string; headers: Record<string, string>; form: FormData } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string>, form: init.body as FormData };
      return json({ status: true, res: { latex: 'x+1', conf: 0.93 }, request_id: 'r' });
    }) as unknown as typeof fetch;
    const out = await invokeSimpleTex({
      baseUrl: 'https://server.simpletex.cn',
      appId: 'APPID',
      appSecret: 'SECRET-VALUE',
      endpoint: '/api/latex_ocr_turbo',
      input: { image: PNG_B64 },
      signal: new AbortController().signal,
      fetchImpl,
      now: () => 1675550577000,
      randomStr: () => 'mSkYSY28N4WkvidB',
    });
    expect(out).toEqual({ text: 'x+1', confidence: 0.93 });
    expect(seen?.url).toBe('https://server.simpletex.cn/api/latex_ocr_turbo');
    expect(Object.keys(seen!.headers).sort()).toEqual(['app-id', 'random-str', 'sign', 'timestamp']);
    expect(JSON.stringify(seen!.headers)).not.toContain('SECRET-VALUE');
    expect(seen!.headers.timestamp).toBe('1675550577');
    expect(seen!.form.get('file')).toBeInstanceOf(Blob);
  });

  it('[EMPTY] 视为空文本；status=false / 缺 res → bad_response；HTTP 非 2xx 只给原因码', async () => {
    expect(parseSimpleTexResponse({ status: true, res: { latex: '[EMPTY]', conf: 0 } }).text).toBe('');
    expect(() => parseSimpleTexResponse({ status: false })).toThrow('bad_response');
    expect(() => parseSimpleTexResponse({ status: true, res: {} })).toThrow('bad_response');
    await expect(
      invokeSimpleTex({
        baseUrl: 'https://x.test',
        appId: 'a',
        appSecret: 's',
        endpoint: '/e',
        input: { image: PNG_B64 },
        signal: new AbortController().signal,
        fetchImpl: (async () => json({ status: false }, 401)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow('http_401');
  });

  it('网络异常不泄露原始错误信息', async () => {
    const err = invokeSimpleTex({
      baseUrl: 'https://x.test',
      appId: 'a',
      appSecret: 's',
      endpoint: '/e',
      input: { image: PNG_B64 },
      signal: new AbortController().signal,
      fetchImpl: (async () => {
        throw new TypeError(`connect to ${PNG_B64} failed`);
      }) as unknown as typeof fetch,
    });
    await expect(err).rejects.toThrow('network');
    await expect(err).rejects.not.toThrow(PNG_B64);
  });
});

describe('Qwen（DashScope）视觉转写', () => {
  it('请求带 P-OCR-1 系统提示与 data URL 图片，temperature=0', () => {
    const body = buildDashscopeRequest('qwen3.8-flash', { image: PNG_B64 }) as {
      model: string;
      temperature: number;
      messages: { role: string; content: unknown }[];
    };
    expect(body.model).toBe('qwen3.8-flash');
    expect(body.temperature).toBe(0);
    expect(body.messages[0]).toEqual({ role: 'system', content: P_OCR_1 });
    expect(JSON.stringify(body.messages[1])).toContain(`data:image/png;base64,${PNG_B64}`);
  });

  it('响应去掉代码块围栏；缺 choices → bad_response', () => {
    expect(parseDashscopeResponse({ choices: [{ message: { content: '```\n任取 $\\varepsilon>0$\n```' } }] }).text).toBe(
      '任取 $\\varepsilon>0$',
    );
    expect(() => parseDashscopeResponse({})).toThrow('bad_response');
  });

  it('Bearer 鉴权，POST /chat/completions', async () => {
    let seen: { url: string; auth: string } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).authorization ?? '' };
      return json({ choices: [{ message: { content: '$x$' } }] });
    }) as unknown as typeof fetch;
    const out = await invokeDashscope({
      baseUrl: 'https://dashscope.test/v1',
      apiKey: 'KEY',
      model: 'm',
      input: { image: PNG_B64 },
      signal: new AbortController().signal,
      fetchImpl,
    });
    expect(out.text).toBe('$x$');
    expect(seen).toEqual({ url: 'https://dashscope.test/v1/chat/completions', auth: 'Bearer KEY' });
  });
});
