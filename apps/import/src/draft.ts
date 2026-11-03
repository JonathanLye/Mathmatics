import { readFileSync } from 'node:fs';

import type { ProblemPackage } from '@proof-gym/engine';

import type { ImportItem } from './split.ts';

export interface DraftPair {
  a: ProblemPackage;
  b: ProblemPackage;
  provider: 'fixture' | 'deepseek';
}

export type FixturePackages = Map<string, ProblemPackage>;

// fixture 支持三种形状：单包 / 包数组 / { items: { [itemId]: pkg } }。
export function loadFixturePackages(file: string): FixturePackages {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const map: FixturePackages = new Map();
  const add = (key: string, value: unknown): void => {
    if (value !== null && typeof value === 'object' && 'schemaVersion' in (value as Record<string, unknown>)) {
      map.set(key, value as ProblemPackage);
    }
  };
  if (Array.isArray(parsed)) {
    parsed.forEach((pkg, index) => add(String(index), pkg));
  } else if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.items !== null && typeof record.items === 'object') {
      for (const [key, value] of Object.entries(record.items as Record<string, unknown>)) add(key, value);
    } else {
      add('default', parsed);
    }
  }
  return map;
}

function pick(map: FixturePackages, itemId: string): ProblemPackage {
  const direct = map.get(itemId) ?? map.get('default') ?? map.values().next().value;
  if (direct === undefined) throw new Error(`fixture 里没有题目包（item ${itemId}）`);
  return structuredClone(direct);
}

async function callDeepSeek(prompt: string, temperature: number): Promise<ProblemPackage> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new Error('未配置 DEEPSEEK_API_KEY；离线请提供 --draft-fixture-a / --draft-fixture-b（10 §6 的 P1 provider 接口）');
  }
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      temperature,
      messages: [
        { role: 'system', content: '你是数学分析题目包起草助手。只输出严格 JSON，符合 problem-package.schema.json（schemaVersion=1.0）。' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek 调用失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = body.choices?.[0]?.message?.content ?? '';
  const json = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(json) as ProblemPackage;
}

export async function twoDrafts(
  item: ImportItem,
  options: { fixtureA?: string; fixtureB?: string },
): Promise<DraftPair> {
  if (options.fixtureA !== undefined && options.fixtureB !== undefined) {
    const a = pick(loadFixturePackages(options.fixtureA), item.itemId);
    const b = pick(loadFixturePackages(options.fixtureB), item.itemId);
    return { a, b, provider: 'fixture' };
  }
  const prompt = [
    '为下面的题干起草完整的题目包（public + secret）：',
    item.body,
    '要求：关键步骤 ≤6、多条路线、H0–H4 与 leak、定义成分、框架检查、自检题、参考证明。',
  ].join('\n');
  const a = await callDeepSeek(prompt, 0.2);
  const b = await callDeepSeek(prompt, 0.8);
  return { a, b, provider: 'deepseek' };
}
