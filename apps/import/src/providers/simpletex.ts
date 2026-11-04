import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { OcrPage } from '../ocr.ts';

import type { FetchLike, OcrImage, OcrProvider } from './types.ts';

// 10 §2 S3：SimpleTex 图片识别（通用 OCR 端点，multipart file + header token）。
// 文档：https://doc.simpletex.cn/zh/api/ ；响应形状需真实 key 验证（测试只 mock）。
export interface SimpleTexOptions {
  apiKey: string;
  endpoint?: string;
  fetch?: FetchLike;
}

export function createSimpleTexOcrProvider(options: SimpleTexOptions): OcrProvider {
  if (options.apiKey.trim() === '') throw new Error('SIMPLEtex_API_KEY 未配置');
  const doFetch = options.fetch ?? fetch;
  const endpoint = options.endpoint ?? 'https://server.simpletex.cn/api/simpletex_ocr';

  return {
    name: 'simpletex',
    async recognize(images: OcrImage[]): Promise<OcrPage[]> {
      const pages: OcrPage[] = [];
      for (const image of images) {
        const form = new FormData();
        form.append('file', new Blob([readFileSync(image.file)], { type: 'image/png' }), basename(image.file));
        const res = await doFetch(endpoint, { method: 'POST', headers: { token: options.apiKey }, body: form });
        if (!res.ok) {
          throw new Error(`SimpleTex OCR 失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        }
        const body = (await res.json()) as {
          status?: boolean;
          message?: string;
          res?: { latex?: string; text?: string } | string;
        };
        if (body.status === false) throw new Error(`SimpleTex 返回失败：${body.message ?? 'unknown'}`);
        const text =
          typeof body.res === 'string' ? body.res : (body.res?.latex ?? body.res?.text ?? '');
        if (text.trim() === '') throw new Error(`SimpleTex 第 ${image.page} 页没有识别文本`);
        pages.push({ page: image.page, text: text.trim() });
      }
      return pages;
    },
  };
}
