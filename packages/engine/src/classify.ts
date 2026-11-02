import { matchesAny } from './canon.ts';
import type { KeyStep, Secret } from './types.ts';

// 归类（09 §6）：规则先行。先看错误类型（errors 优先），再看关键步骤（keys）。
// 模型结果不参与归类（P0）。
export type Classification =
  | { type: 'err'; errorId: string; question: string }
  | { type: 'match'; keys: string[] }
  | { type: 'unknown' };

export function classifyLine(secret: Secret, text: string): Classification {
  for (const err of secret.errors) {
    if (matchesAny(err.patterns, text)) return { type: 'err', errorId: err.id, question: err.question };
  }
  const keys = secret.keys.filter((k) => matchesAny(k.patterns, text)).map((k) => k.id);
  return keys.length > 0 ? { type: 'match', keys } : { type: 'unknown' };
}

// 按路线取第一个未写出的关键步骤；链条闭合时返回 null。
export function nextKey(secret: Secret, matched: ReadonlySet<string>): KeyStep | null {
  for (const route of secret.routes) {
    for (const id of route) {
      if (matched.has(id)) continue;
      const key = secret.keys.find((k) => k.id === id);
      if (!key) throw new Error(`路线引用了不存在的关键步骤 ${id}`);
      return key;
    }
  }
  return null;
}
