import type { ProblemPackage } from '@proof-gym/engine';

import type { DraftPair, DraftProvider, FetchLike } from './types.ts';

// 10 §2 S6：第二模型起草（DashScope OpenAI 兼容 text chat，默认 qwen-plus）。
// 与 DeepSeek 分开调用，供 S7 双模型仲裁；没有 key 时由 draft.ts 回退到同模型双温度。
export interface QwenDraftOptions {
  apiKey: string;
  endpoint?: string;
  model?: string;
  fetch?: FetchLike;
}

const SYSTEM = '你是数学分析题目包起草助手。只输出严格 JSON（json），符合 problem-package.schema.json（schemaVersion=1.0）。';

export function createQwenDraftProvider(options: QwenDraftOptions): DraftProvider {
  if (options.apiKey.trim() === '') throw new Error('DASHSCOPE_API_KEY 未配置（Qwen 起草需要）');
  const doFetch = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const model = options.model ?? process.env.QWEN_DRAFT_MODEL ?? 'qwen-plus';

  async function call(prompt: string, temperature: number): Promise<ProblemPackage> {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Qwen 起草失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? '';
    const json = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    try {
      return JSON.parse(json) as ProblemPackage;
    } catch {
      throw new Error('Qwen 返回的不是合法 JSON');
    }
  }

  function promptFor(item: { itemId: string; body: string }): string {
    return [
      '为下面的题干起草完整的题目包（public + secret），JSON 需符合 problem-package.schema.json。',
      `条目：${item.itemId}`,
      item.body,
      '要求：关键步骤 ≤6、多条路线、H0–H4 与 leak、定义成分、框架检查、自检题、参考证明。',
    ].join('\n');
  }

  return {
    name: 'qwen',
    async draftOnce(item): Promise<ProblemPackage> {
      return call(promptFor(item), 0.6);
    },
    async twoDrafts(item): Promise<DraftPair> {
      const prompt = promptFor(item);
      const a = await call(prompt, 0.2);
      const b = await call(prompt, 0.6);
      return { a, b };
    },
  };
}
