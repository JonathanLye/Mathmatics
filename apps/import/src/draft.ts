import { readFileSync } from 'node:fs';

import type { ProblemPackage } from '@proof-gym/engine';

import { createDeepSeekDraftProvider } from './providers/deepseek.ts';
import type { DraftProvider } from './providers/types.ts';
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

export interface TwoDraftsOptions {
  fixtureA?: string;
  fixtureB?: string;
  draftProvider?: DraftProvider;
}

export async function twoDrafts(item: ImportItem, options: TwoDraftsOptions): Promise<DraftPair> {
  if (options.fixtureA !== undefined && options.fixtureB !== undefined) {
    const a = pick(loadFixturePackages(options.fixtureA), item.itemId);
    const b = pick(loadFixturePackages(options.fixtureB), item.itemId);
    return { a, b, provider: 'fixture' };
  }
  const provider =
    options.draftProvider ??
    createDeepSeekDraftProvider({
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
      model: process.env.DEEPSEEK_MODEL,
    });
  const pair = await provider.twoDrafts({ itemId: item.itemId, body: item.body });
  return { ...pair, provider: 'deepseek' };
}
