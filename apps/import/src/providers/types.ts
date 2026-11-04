import type { ProblemPackage } from '@proof-gym/engine';

import type { OcrPage } from '../ocr.ts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OcrImage {
  page: number;
  file: string;
}

export interface OcrProvider {
  name: 'fixture' | 'simpletex' | 'qwen';
  recognize(images: OcrImage[]): Promise<OcrPage[]>;
}

export interface DraftPair {
  a: ProblemPackage;
  b: ProblemPackage;
}

export interface DraftProvider {
  name: 'deepseek' | 'qwen';
  twoDrafts(item: { itemId: string; body: string }): Promise<DraftPair>;
  // 双模型起草时只取一份稿，避免浪费第二次调用；不实现则回退 twoDrafts。
  draftOnce?(item: { itemId: string; body: string }): Promise<ProblemPackage>;
}
