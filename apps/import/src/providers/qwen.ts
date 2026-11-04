import { readFileSync } from 'node:fs';

import type { OcrPage } from '../ocr.ts';

import type { FetchLike, OcrImage, OcrProvider } from './types.ts';

// 10 §2 S3 备选：Qwen-VL（DashScope OpenAI 兼容端点，image_url 传 base64 data URL）。
// 文档：https://platform.qianwenai.com/docs/developer-guides/multimodal/vision
export interface QwenOptions {
  apiKey: string;
  endpoint?: string;
  model?: string;
  fetch?: FetchLike;
}

const PROMPT = '把图片中的数学题目/解答原文转写为 Markdown；行内公式用 $...$，不要解释、不要补全。';

export function createQwenOcrProvider(options: QwenOptions): OcrProvider {
  if (options.apiKey.trim() === '') throw new Error('DASHSCOPE_API_KEY 未配置');
  const doFetch = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const model = options.model ?? process.env.QWEN_VL_MODEL ?? 'qwen-vl-max';

  return {
    name: 'qwen',
    async recognize(images: OcrImage[]): Promise<OcrPage[]> {
      const pages: OcrPage[] = [];
      for (const image of images) {
        const dataUrl = `data:image/png;base64,${readFileSync(image.file).toString('base64')}`;
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: dataUrl } },
                  { type: 'text', text: PROMPT },
                ],
              },
            ],
          }),
        });
        if (!res.ok) {
          throw new Error(`Qwen-VL OCR 失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = body.choices?.[0]?.message?.content ?? '';
        if (text.trim() === '') throw new Error(`Qwen-VL 第 ${image.page} 页没有识别文本`);
        pages.push({ page: image.page, text: text.trim() });
      }
      return pages;
    },
  };
}
