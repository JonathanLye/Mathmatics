import { canon } from './canon.ts';
import type { Secret } from './types.ts';

// 闸门规则层（09 §7.2 ①）。所有外发文本都要过这一关，发布穷举检查（leak.ts）也调用它。
export interface LeakHit {
  key: string;
  frag: string;
}

export type GateResult = { ok: true } | { ok: false; hits: LeakHit[] };

// allow 由调用方给出：学生已写出的关键步骤 ∪ 本条提示所属、透露量为 1 的步骤。
// 片段按"原样 + canon 后"两路匹配，已是 canon 形式的片段不会被二次 canon 破坏。
export function gateRule(
  secret: Secret,
  text: string,
  matched: ReadonlySet<string>,
  allow: readonly string[],
): GateResult {
  const c = canon(text);
  const hits: LeakHit[] = [];
  for (const key of secret.keys) {
    if (matched.has(key.id) || allow.includes(key.id)) continue;
    for (const frag of key.leak) {
      if (c.includes(frag) || c.includes(canon(frag))) hits.push({ key: key.id, frag });
    }
  }
  return hits.length > 0 ? { ok: false, hits } : { ok: true };
}

// 提示的允许清单：只有透露量为 1（H3/H4）的本步骤片段可以出现。H2 只指方向（09 §7.2，比 v3 原型更严）。
// H4 带 handsBack（把下一行交还学生）同样是 cost=1，因此同样放行本步骤片段。
export function hintAllow(keyId: string, cost: number): string[] {
  return cost === 1 ? [keyId] : [];
}
