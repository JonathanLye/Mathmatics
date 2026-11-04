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
  name: 'deepseek';
  twoDrafts(item: { itemId: string; body: string }): Promise<DraftPair>;
}
