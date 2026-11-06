import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { replayProofLines, splitProofLines } from '@proof-gym/content-checks';
import type { ProblemPackage } from '@proof-gym/engine';

import { parseJsonLoose, type ChatClient, type Provider } from './llm.ts';
import { writeAtomic } from './ocr-stage.ts';

// 变式测试：让另一个模型按学生的写法重写一遍证明，看规则能认出多少关键步骤。
// 这是对“模式是否过拟合参考证明”的抽样测量，只进报告，不决定发布。
export const VARIATION_MODEL = 'deepseek-flash';
export const VARIATION_PROVIDER: Provider = 'deepseek';

export const VARIATION_SYSTEM = [
  '你是正在学数学分析的大学生。给你一道证明题和一份参考证明，请用自己的话把证明重新写一遍。',
  '要求：证明思路相同、数学上正确；但措辞、句式、行的划分都要和参考证明不同，就像学生自己写的作业。',
  '每行写一步，数学式写在 $...$ 里（不用 $$），不写行号，不用 Markdown 记号。',
  '只输出 JSON：{"lines":["第一行","第二行"]}',
].join('\n');

export interface VariationResult {
  problemId: string;
  keys: number;
  matched: number;
  finished: boolean;
  missing: string[];
  lines: string[];
  error?: string;
}

export function sampleForVariation(ids: readonly string[], rate: number): string[] {
  const limit = Math.max(1, Math.ceil(ids.length * rate));
  return [...ids]
    .map((id) => ({ id, rank: createHash('sha256').update(`variation:${id}`).digest('hex') }))
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .slice(0, limit)
    .map((entry) => entry.id);
}

export async function runVariation(pkg: ProblemPackage, client: ChatClient, outDir: string): Promise<VariationResult> {
  const dir = join(outDir, 'variation');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${pkg.id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as VariationResult;
  const proof = pkg.secret.referenceProofs[0]?.text ?? '';
  const response = await client.chat({
    stage: 'variation',
    ref: pkg.id,
    provider: VARIATION_PROVIDER,
    model: VARIATION_MODEL,
    temperature: 0.7,
    json: true,
    maxTokens: 4000,
    messages: [
      { role: 'system', content: VARIATION_SYSTEM },
      { role: 'user', content: `【题面】${pkg.public.stem}\n【参考证明】\n${proof}` },
    ],
  });
  const raw = parseJsonLoose<{ lines?: unknown }>(response.text);
  const lines = Array.isArray(raw.lines)
    ? raw.lines.filter((line): line is string => typeof line === 'string').flatMap((line) => splitProofLines(line))
    : [];
  const replay = replayProofLines(pkg, lines);
  const result: VariationResult = {
    problemId: pkg.id,
    keys: pkg.secret.keys.length,
    matched: replay.matched.length,
    finished: replay.canFinish,
    missing: replay.missing,
    lines,
  };
  writeAtomic(file, `${JSON.stringify(result)}\n`);
  return result;
}

export function summarizeVariation(results: readonly VariationResult[]): {
  sampled: number;
  finishRate: number;
  keyRate: number;
} {
  const keys = results.reduce((sum, result) => sum + result.keys, 0);
  const matched = results.reduce((sum, result) => sum + result.matched, 0);
  const finished = results.filter((result) => result.finished).length;
  return {
    sampled: results.length,
    finishRate: results.length === 0 ? 0 : Number((finished / results.length).toFixed(3)),
    keyRate: keys === 0 ? 0 : Number((matched / keys).toFixed(3)),
  };
}
