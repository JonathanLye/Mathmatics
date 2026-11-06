import {
  canon,
  classifyLine,
  createAttempt,
  step,
  type AttemptState,
  type ConceptsFile,
  type Context,
  type ProblemPackage,
} from '@proof-gym/engine';

import type { CheckIssue } from './index.ts';

// 参考证明回放（U16 的发布门禁）：patternSelfTest 只查结构，导入题可能永远达不到 canFinish；
// 这里用真实引擎把参考证明逐行提交一遍，走不通就不发布。

export interface ReplayLine {
  n: number;
  text: string;
  canon: string;
  cls: 'match' | 'error' | 'unknown' | 'invalid';
  keys: string[];
  errorId?: string;
}

export interface ReplayResult {
  ok: boolean;
  issues: CheckIssue[];
  lines: ReplayLine[];
  matched: string[];
  missing: string[];
  canFinish: boolean;
  completed: boolean;
}

// 按换行切；一行里有多句时，再在公式外的句号、分号处切开。学生也是一行写一步。
export function splitProofLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let current = '';
    let inMath = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i] as string;
      if (ch === '\\' && raw[i + 1] === '$') {
        current += '\\$';
        i += 1;
        continue;
      }
      if (ch === '$') inMath = !inMath;
      current += ch;
      if (!inMath && (ch === '。' || ch === '；')) {
        out.push(current);
        current = '';
      }
    }
    out.push(current);
  }
  return out.map((line) => line.trim()).filter((line) => line.length > 0);
}

// 只走第 3 层 + 第 6 层：回放关心的是链条能否闭合，前置层靠学生的定义与骨架，与此无关。
function replayView(pkg: ProblemPackage): ProblemPackage {
  const off = { enabled: false };
  return {
    ...pkg,
    public: {
      ...pkg.public,
      layers: {
        L1: off,
        L2: off,
        L3: { enabled: true, skippable: false, skipRule: 'none' },
        L4: off,
        L5: off,
        L6: pkg.public.layers.L6,
      },
    },
  } as ProblemPackage;
}

export function replayProofLines(
  pkg: ProblemPackage,
  proofLines: readonly string[],
  concepts: ConceptsFile = { concepts: [], glossary: [] },
): ReplayResult {
  const view = replayView(pkg);
  const ctx: Context = { pkg: view, concepts };
  let at = 1_000_000;
  let state: AttemptState = createAttempt(ctx, at);
  const issues: CheckIssue[] = [];
  const lines: ReplayLine[] = [];

  proofLines.forEach((text, index) => {
    at += 60_000;
    const result = step(ctx, state, { kind: 'line.submit', lineId: `L${index + 1}`, s: text, j: '', provenance: 'keyboard' }, at);
    state = result.state;
    const classified = classifyLine(view.secret, text);
    if (result.rejected !== undefined) {
      lines.push({ n: index + 1, text, canon: canon(text), cls: 'invalid', keys: [] });
      issues.push({ where: `replay.line${index + 1}`, message: `引擎拒绝这一行（${result.rejected}）：${text}` });
      return;
    }
    if (classified.type === 'err') {
      lines.push({ n: index + 1, text, canon: canon(text), cls: 'error', keys: [], errorId: classified.errorId });
      issues.push({
        where: `replay.line${index + 1}`,
        message: `参考证明这一行被错误类型 ${classified.errorId} 截走：${text}（canon: ${canon(text)}）`,
      });
    } else if (classified.type === 'match') {
      lines.push({ n: index + 1, text, canon: canon(text), cls: 'match', keys: classified.keys });
    } else {
      lines.push({ n: index + 1, text, canon: canon(text), cls: 'unknown', keys: [] });
    }
  });

  const matched = [...state.hint.matched];
  const missing = view.secret.keys.map((key) => key.id).filter((id) => !state.hint.matched.has(id));
  for (const id of missing) {
    const key = view.secret.keys.find((item) => item.id === id);
    issues.push({ where: `replay.${id}`, message: `参考证明没有任何一行命中 ${id}（${key?.label ?? ''}）` });
  }

  at += 60_000;
  const finish = step(ctx, state, { kind: 'finish.try' }, at);
  state = finish.state;
  const finishEvent = finish.events.find((event) => event.type === 'finish.try');
  const canFinish = finishEvent?.payload.complete === true;
  if (!canFinish) issues.push({ where: 'replay.finish', message: '参考证明写完后链条仍未闭合（finish.try 未完成）' });

  let completed = state.done;
  if (canFinish && !completed && view.public.layers.L6.enabled) {
    // 第 6 层：要点没命中时追问一次，第二次放行。这里验证的是“一定走得完”。
    const answers = ['这道题的关键步骤与依据我已经总结好了。'];
    for (let attempt = 0; attempt < 2 && !completed; attempt += 1) {
      at += 60_000;
      const summary = step(ctx, state, { kind: 'summary.submit', answers }, at);
      state = summary.state;
      completed = state.done;
    }
  }
  if (canFinish && !completed) issues.push({ where: 'replay.summary', message: '第 6 层提交后作答仍未完成' });

  return { ok: issues.length === 0, issues, lines, matched, missing, canFinish, completed };
}

export function replayReferenceProof(
  pkg: ProblemPackage,
  concepts: ConceptsFile = { concepts: [], glossary: [] },
): ReplayResult {
  const proofs = pkg.secret.referenceProofs ?? [];
  const first = proofs[0];
  if (first === undefined) {
    return {
      ok: false,
      issues: [{ where: 'secret.referenceProofs', message: '没有参考证明，无法回放' }],
      lines: [],
      matched: [],
      missing: pkg.secret.keys.map((key) => key.id),
      canFinish: false,
      completed: false,
    };
  }
  const result = replayProofLines(pkg, splitProofLines(first.text), concepts);
  const contributing = new Set(result.lines.filter((line) => line.keys.length > 0).map((line) => line.n));
  if (pkg.secret.keys.length >= 3 && contributing.size < 2) {
    result.issues.push({ where: 'replay.lines', message: '一行就覆盖了全部关键步骤：关键步骤的模式太宽，或没有真正拆开' });
    result.ok = false;
  }
  return result;
}
