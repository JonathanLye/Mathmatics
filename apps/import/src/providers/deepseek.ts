import type { ProblemPackage } from '@proof-gym/engine';

import type { DraftPair, DraftProvider, FetchLike } from './types.ts';

// 10 §2 S6：DeepSeek 起草（OpenAI 兼容；response_format json_object 要求 prompt 含 json 字样）。
// 文档：https://api-docs.deepseek.com/zh-cn/guides/json_mode/
export interface DeepSeekOptions {
  apiKey: string;
  endpoint?: string;
  model?: string;
  fetch?: FetchLike;
}

const SYSTEM = '你是数学分析题目包起草助手。只输出严格 JSON（json），符合 problem-package.schema.json（schemaVersion=1.0）。';

export function createDeepSeekDraftProvider(options: DeepSeekOptions): DraftProvider {
  if (options.apiKey.trim() === '') {
    throw new Error('未配置 DEEPSEEK_API_KEY；离线请提供 --draft-fixture-a / --draft-fixture-b');
  }
  const doFetch = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? 'https://api.deepseek.com/chat/completions';
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  async function call(prompt: string, temperature: number): Promise<ProblemPackage> {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek 调用失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? '';
    const json = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    try {
      return JSON.parse(json) as ProblemPackage;
    } catch {
      throw new Error('DeepSeek 返回的不是合法 JSON（已要求 json_object）');
    }
  }

  return {
    name: 'deepseek',
    async twoDrafts(item): Promise<DraftPair> {
      const prompt = [
        `为下面的题干起草完整的题目包（public + secret）。JSON 需符合 problem-package.schema.json。`,
        `条目：${item.itemId}`,
        item.body,
        '要求：关键步骤 ≤6、多条路线、H0–H4 与 leak、定义成分、框架检查、自检题、参考证明。',
      ].join('\n');
      const a = await call(prompt, 0.2);
      const b = await call(prompt, 0.8);
      return { a, b };
    },
  };
}
