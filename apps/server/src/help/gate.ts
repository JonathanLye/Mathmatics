// 模型生成文本的三重闸门（09 §7.2）。顺序：规则 → 格式 → 语义复核。任一失败、超时、复核输出不是严格 JSON，一律拦。
//
// ① 规则：未透露关键步骤的 leak 片段（引擎 gateRule），再加两路 canon 匹配：未透露步骤的 examples 整句，
//    以及未透露步骤 H3/H4 提示里的式子（题面里本来就有的式子除外）。
// ② 格式：长度上限、不含内部术语、不像完整证明（编号步骤、多个独立公式、“证明：”开头）、所有 $…$ 能被 KaTeX 解析。
// ③ 语义：独立的复核调用看得到未透露的步骤，判断“换个说法的泄题”——片段匹配抓不到的那种。
//
// 这里不碰数据库、不碰网络：复核函数由调用方注入（answer.ts 接网关，测试接桩）。

import { createHash } from 'node:crypto';

import { canon, gateRule, type Secret } from '@proof-gym/engine';

export type GateKind = 'free' | 'concept' | 'check_line';

export type GateStage =
  | { stage: 'rule'; hit: boolean; keys?: string[] }
  | { stage: 'format'; ok: boolean; reason?: string }
  | { stage: 'cross'; leak?: boolean; failed?: string; skipped?: boolean };

export interface GateOutcome {
  ok: boolean;
  stages: GateStage[];
  blockedKeys: string[];
  textHash: string;
}

// 复核调用的结果：status=ok 时 leak 才有意义；其余（超时、错误、非 JSON）都按“拦”处理。
export type ReviewResult = { status: 'ok'; leak: boolean } | { status: 'failed'; reason: string };

export interface UnrevealedStep {
  id: string;
  label: string;
  // 该步骤的完整内容（H4 提示：把这一步写出来的那条），只给复核模型看
  content: string;
  leak: string[];
}

export interface GateInput {
  secret: Secret;
  matched: ReadonlySet<string>;
  stem: string;
  text: string;
  review(candidate: string, unrevealed: UnrevealedStep[]): Promise<ReviewResult>;
  parsesMath(math: string): boolean;
}

const MAX_CHARS = 420;
const INTERNAL_TERMS = /K\d+|leak|secret|prompt|JSON|\bH[0-4]\b|系统提示|提示词|题目包|参考证明|参考答案|标准答案|透露量|闸门|关键步骤|reference/i;

export const textHashOf = (text: string): string => createHash('sha256').update(text).digest('hex');

function mathSegments(text: string): string[] {
  return [...text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g)].map((m) => (m[1] ?? m[2] ?? '').trim());
}

// 未透露的关键步骤（按题目包顺序）。
export function unrevealedSteps(secret: Secret, matched: ReadonlySet<string>): UnrevealedStep[] {
  return secret.keys
    .filter((key) => !matched.has(key.id))
    .map((key) => {
      const h4 = key.hints.find((h) => h.level === 'H4') ?? key.hints.find((h) => h.level === 'H3');
      return { id: key.id, label: key.label, content: h4?.text ?? '', leak: key.leak };
    });
}

// 规则层的第二路：整句 examples 与 H3/H4 里的式子（canon 后至少 6 个字符，且不是题面本身的式子）。
function extraRuleHits(secret: Secret, matched: ReadonlySet<string>, stem: string, text: string): string[] {
  const c = canon(text);
  const stemCanon = canon(stem);
  const hits: string[] = [];
  for (const key of secret.keys) {
    if (matched.has(key.id)) continue;
    const pieces: string[] = [];
    for (const example of key.examples ?? []) pieces.push(canon(example));
    for (const hint of key.hints) {
      if (hint.level === 'H3' || hint.level === 'H4') for (const math of mathSegments(hint.text)) pieces.push(canon(math));
    }
    for (const piece of pieces) {
      if (piece.length >= 6 && !stemCanon.includes(piece) && c.includes(piece)) {
        hits.push(key.id);
        break;
      }
    }
  }
  return hits;
}

export function formatProblem(text: string, parsesMath: (math: string) => boolean): string | null {
  const plain = text.trim();
  if (plain.length < 2) return 'too_short';
  if ([...plain].length > MAX_CHARS) return 'too_long';
  if (INTERNAL_TERMS.test(plain)) return 'internal_term';
  if ((plain.match(/\$/g) ?? []).length % 2 !== 0) return 'unbalanced_math';
  if (plain.includes('$$')) return 'display_math';
  if ((plain.match(/\n/g) ?? []).length > 3) return 'too_many_lines';
  if (/^\s*\d+[.、)）]\s*\S/m.test(plain) && (plain.match(/^\s*\d+[.、)）]/gm) ?? []).length >= 2) return 'numbered_steps';
  if (/第[一二三1-3]步[\s\S]*第[二三四2-4]步/.test(plain)) return 'step_list';
  if (/^\s*(证明|解|证)[:：]/.test(plain)) return 'proof_opening';
  if (/```|^#{1,6}\s|\*\*/m.test(plain)) return 'markdown';
  const maths = mathSegments(plain);
  // 单个符号（$N$、$\varepsilon$）不算公式：概念讲解里很常见；防的是整段推导。
  if (maths.filter((m) => !/^\\?[A-Za-z]+(_\{?\w+\}?)?$/.test(m.trim())).length > 6) return 'too_many_formulas';
  if (maths.filter((m) => m.includes('=') || /[<>≤≥]/.test(m)).length > 3) return 'too_many_relations';
  for (const math of maths) if (!parsesMath(math)) return 'katex';
  return null;
}

export async function runGate(input: GateInput): Promise<GateOutcome> {
  const { secret, matched, text } = input;
  const textHash = textHashOf(text);
  const stages: GateStage[] = [];

  const rule = gateRule(secret, text, matched, []);
  const ruleKeys = rule.ok ? [] : [...new Set(rule.hits.map((hit) => hit.key))];
  const extra = extraRuleHits(secret, matched, input.stem, text);
  const blockedKeys = [...new Set([...ruleKeys, ...extra])];
  stages.push({ stage: 'rule', hit: blockedKeys.length > 0, ...(blockedKeys.length > 0 ? { keys: blockedKeys } : {}) });
  if (blockedKeys.length > 0) return { ok: false, stages, blockedKeys, textHash };

  const problem = formatProblem(text, input.parsesMath);
  stages.push({ stage: 'format', ok: problem === null, ...(problem === null ? {} : { reason: problem }) });
  if (problem !== null) return { ok: false, stages, blockedKeys, textHash };

  const unrevealed = unrevealedSteps(secret, matched);
  if (unrevealed.length === 0) {
    stages.push({ stage: 'cross', skipped: true });
    return { ok: true, stages, blockedKeys, textHash };
  }
  let verdict: ReviewResult;
  try {
    verdict = await input.review(text, unrevealed);
  } catch {
    verdict = { status: 'failed', reason: 'exception' };
  }
  if (verdict.status !== 'ok') {
    stages.push({ stage: 'cross', failed: verdict.reason });
    return { ok: false, stages, blockedKeys, textHash };
  }
  stages.push({ stage: 'cross', leak: verdict.leak });
  return { ok: !verdict.leak, stages, blockedKeys, textHash };
}
