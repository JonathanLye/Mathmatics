import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import { createDeepSeekDraftProvider } from '../src/providers/deepseek.ts';
import { createQwenOcrProvider } from '../src/providers/qwen.ts';
import { createSimpleTexOcrProvider } from '../src/providers/simpletex.ts';
import type { FetchLike } from '../src/providers/types.ts';

function imageFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pg-provider-'));
  const file = join(dir, 'page-027.png');
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return file;
}

function seedJson(): string {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json'));
  return JSON.stringify(JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('导入 provider（#42 S3/S6）', () => {
  it('SimpleTex：multipart file + token 头；解析 res.latex', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ status: true, res: { latex: '\\frac{1}{2}' } });
    };
    const provider = createSimpleTexOcrProvider({ apiKey: 'uat-token', fetch: fake });
    const pages = await provider.recognize([{ page: 27, file: imageFile() }]);
    expect(pages).toEqual([{ page: 27, text: '\\frac{1}{2}' }]);
    expect(calls[0]?.url).toContain('/api/simpletex_ocr');
    expect((calls[0]?.init?.headers as Record<string, string>).token).toBe('uat-token');
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
  });

  it('SimpleTex：HTTP 失败与空文本都报错', async () => {
    const bad = createSimpleTexOcrProvider({
      apiKey: 'k',
      fetch: async () => new Response('boom', { status: 500 }),
    });
    await expect(bad.recognize([{ page: 1, file: imageFile() }])).rejects.toThrow('HTTP 500');
    const empty = createSimpleTexOcrProvider({
      apiKey: 'k',
      fetch: async () => jsonResponse({ status: true, res: { latex: '  ' } }),
    });
    await expect(empty.recognize([{ page: 1, file: imageFile() }])).rejects.toThrow('没有识别文本');
  });

  it('Qwen-VL：OpenAI 兼容 body，image_url 为 base64 data URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ choices: [{ message: { content: '例1 证明 $a_n\\to 3$。' } }] });
    };
    const provider = createQwenOcrProvider({ apiKey: 'dash-key', model: 'qwen-vl-max', fetch: fake });
    const pages = await provider.recognize([{ page: 27, file: imageFile() }]);
    expect(pages[0]?.text).toContain('$a_n');
    const init = calls[0]?.init as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer dash-key');
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(body.model).toBe('qwen-vl-max');
    const image = body.messages[0]?.content.find((part) => part.type === 'image_url');
    expect(image?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('DeepSeek：双温度起草 + json_object，解析题目包', async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fake: FetchLike = async (_url, init) => {
      calls.push({ init });
      return jsonResponse({ choices: [{ message: { content: seedJson() } }] });
    };
    const provider = createDeepSeekDraftProvider({ apiKey: 'ds-key', model: 'deepseek-chat', fetch: fake });
    const pair = await provider.twoDrafts({ itemId: 'p27-i0', body: '例1 证明 lim a_n = 3' });
    expect(pair.a.id).toBe('epsN');
    expect(pair.b.id).toBe('epsN');
    expect(calls).toHaveLength(2);
    const bodies = calls.map((call) => JSON.parse(String(call.init?.body)) as { temperature: number; response_format: { type: string } });
    expect(bodies.map((body) => body.temperature)).toEqual([0.2, 0.8]);
    expect(bodies[0]?.response_format.type).toBe('json_object');
  });

  it('DeepSeek：非 JSON 响应报错，不静默', async () => {
    const provider = createDeepSeekDraftProvider({
      apiKey: 'k',
      fetch: async () => jsonResponse({ choices: [{ message: { content: '不是 JSON' } }] }),
    });
    await expect(provider.twoDrafts({ itemId: 'x', body: 'y' })).rejects.toThrow('不是合法 JSON');
  });
});
