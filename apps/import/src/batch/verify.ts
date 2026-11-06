import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseJsonLoose, providerOf, type ChatClient } from './llm.ts';
import { writeAtomic } from './ocr-stage.ts';
import type { SegmentedItem } from './segment.ts';

// 题面整理与完整性、可证明性校验。这一轮文本阶段全部用 deepseek-flash，第二模型核验暂停（owner 决定）；
// manifest 里每题记录谁写、谁查，以后要补查可以按它筛。
export const NORMALIZE_MODEL = 'deepseek-flash';
export const REPAIR_MODEL = 'deepseek-flash';
export const VERIFY_MODEL = 'deepseek-flash';
export const MIN_CONFIDENCE = 0.8;

export const NORMALIZE_SYSTEM = [
  '你在整理数学分析教辅的 OCR 文本，把一个条目整理成可以独立使用的证明题。',
  '只修 OCR 造成的问题（断行、公式错位、明显的识别错字、把 LaTeX 写规范），不许改变数学内容，不许补充原文没有的条件或步骤，不许改写证明思路。',
  '输出格式：',
  '- 所有数学式写在 $...$ 里（行内，不用 $$，一对 $ 不跨行）；不用 Markdown 记号。',
  '- 去掉题号、圆圈记号、“证明”“证”“解”这些栏目词。',
  '小题的处理：',
  '- 如果条目有多个小题且可以各自独立证明，拆成多个 part：每个 part 的 statement 都要把公共条件写全，让它脱离其它小题也完整；solution 只留这一小题的证明。',
  '- 如果后面的小题要用前面小题的结论，就把它们合成一个 part。',
  '- 计算题、求值题、讨论题这类不是证明的小题直接丢掉；题面是判断对错或讨论、但解答给出了完整证明的，把题面改写成“证明……”，结论来自解答。',
  '判断 usable=false 的情况（写明 rejectReason）：',
  'needs_figure（必须看图）、refers_other（题面或证明依赖别的题的结论且原文没有给出）、garbled（文字或公式乱到无法确定原意）、not_proof（不是证明题）、incomplete（题面或解答残缺，比如解答被截断）。',
  '只输出 JSON：{"usable":true,"rejectReason":null,"parts":[{"no":"1","statement":"设 ...，证明 ...","solution":"..."}]}',
].join('\n');

export const VERIFY_SYSTEM = [
  '你是严格的数学审稿人。下面是一道证明题的题面与解答，它们将不经人工审核直接发给学生，所以宁可拒绝也不要放过有问题的题。',
  '逐句读题面和解答，判断：',
  '1. statementComplete：题面是否完整。条件、记号、要证的结论都写全了吗？有没有被截断或明显的识别错误？',
  '2. selfContained：题面脱离原书能否看懂？是否依赖图、依赖别的题或书里某个编号的结论而又没有说明？',
  '3. solutionProvesStatement：解答是否真的证明了题面的结论？每一步都能成立吗？有没有缺失的假设、循环论证、只证了一部分或计算错误？引用别的习题的结论而没有证明，算缺口；引用教材里有名字的标准定理（如夹逼准则、拉格朗日中值定理）不算缺口。',
  '4. gaps：把发现的每个缺口写成一句话。没有就给空数组。',
  '5. difficulty：按下面的量表给 1–5 的难度。',
  '6. confidence：你对以上判断的把握，0 到 1。',
  '难度量表（相对这本习题集，看关键步骤数、要用的技巧、有多常规）。全书大致分布是 1–2 占 35%、3 占 40%、4–5 占 25%，不要把大多数题都打成 1–2：',
  '1 入门：直接套定义或一个公式，一两步结束。例：用 ε-N 定义证明 $\\lim_{n\\to\\infty}\\frac{1}{n^2}=0$。例：证明 $|a|-|b|\\leqslant|a-b|$。',
  '2 入门：常规题，一次放缩或直接用一个定理。例：证明 $\\lim_{n\\to\\infty}\\frac{3n+1}{n+2}=3$。例：设 $f,g$ 在 $x_0$ 连续，证明 $\\max\\{f,g\\}$ 在 $x_0$ 连续。',
  '3 进阶：3–5 步，要组合两个结论、分情况讨论、做一个辅助函数，或者用到中值定理、闭区间套、一致收敛这样的工具。例：证明数列 $a_{n+1}=\\sqrt{c+a_n}$ 收敛并求极限。例：用拉格朗日中值定理证明 $\\frac{h^2}{1+h^2}<\\arctan h<h$。例：$\\sum u_n(x)$ 一致收敛且 $g$ 有界，证明 $\\sum g(x)u_n(x)$ 一致收敛。',
  '4 挑战：要选对方法或做非显然的构造，或者解答在 6 步以上。例：$f$ 在 $[a,+\\infty)$ 连续且 $\\lim_{x\\to+\\infty}f(x)$ 存在，证明 $f$ 一致连续。例：证明重要的不等式或判别法本身。',
  '5 挑战：综合多个定理、需要巧妙构造。例：证明狄尼定理。例：考研真题里的综合证明题。',
  '只输出 JSON：{"statementComplete":true,"selfContained":true,"solutionProvesStatement":true,"gaps":[],"difficulty":3,"confidence":0.9}',
].join('\n');

export const REPAIR_SYSTEM = [
  '你在修补一道数学证明题的书面解答。审稿人指出了缺口。',
  '只补足缺口，写出完整、严格、一步步能核对的证明；不改题面，尽量保留原有思路；所有数学式写在 $...$ 里（不用 $$，一对 $ 不跨行），不用 Markdown 记号。',
  '如果题面本身是错的或缺条件，无法修补，就输出 {"repairable":false}。',
  '只输出 JSON：{"repairable":true,"solution":"..."}',
].join('\n');

export interface NormalizedPart {
  partId: string;
  no: string;
  statement: string;
  solution: string;
}

export interface NormalizedItem {
  itemId: string;
  usable: boolean;
  rejectReason?: string;
  parts: NormalizedPart[];
}

export interface VerifyVerdict {
  statementComplete: boolean;
  selfContained: boolean;
  solutionProvesStatement: boolean;
  gaps: string[];
  difficulty: number;
  confidence: number;
}

export interface VerifiedPart {
  partId: string;
  itemId: string;
  statement: string;
  solution: string;
  accepted: boolean;
  reason?: string;
  repaired: boolean;
  verdict: VerifyVerdict;
  firstVerdict?: VerifyVerdict;
  verifierModel?: string;
}

// 没有 verifierModel 字段的旧结果也是 deepseek-flash 核验的。
export function checkerOf(part: Pick<VerifiedPart, 'verifierModel'>): string {
  return part.verifierModel ?? 'deepseek-flash';
}

export function parseVerdict(text: string): VerifyVerdict {
  const raw = parseJsonLoose<Record<string, unknown>>(text);
  const difficulty = Number(raw.difficulty);
  const confidence = Number(raw.confidence);
  return {
    statementComplete: raw.statementComplete === true,
    selfContained: raw.selfContained === true,
    solutionProvesStatement: raw.solutionProvesStatement === true,
    gaps: Array.isArray(raw.gaps) ? raw.gaps.map(String) : [],
    difficulty: Number.isFinite(difficulty) ? Math.min(5, Math.max(1, Math.round(difficulty))) : 3,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

export function verdictAccepted(verdict: VerifyVerdict): boolean {
  return (
    verdict.statementComplete &&
    verdict.selfContained &&
    verdict.solutionProvesStatement &&
    verdict.gaps.length === 0 &&
    verdict.confidence >= MIN_CONFIDENCE
  );
}

export function rejectionReason(verdict: VerifyVerdict): string {
  if (!verdict.statementComplete) return 'statement_incomplete';
  if (!verdict.selfContained) return 'not_self_contained';
  if (!verdict.solutionProvesStatement) return 'solution_gap';
  if (verdict.gaps.length > 0) return 'solution_gap';
  if (verdict.confidence < MIN_CONFIDENCE) return 'low_confidence';
  return 'unknown';
}

export async function normalizeItem(item: SegmentedItem, client: ChatClient, outDir: string): Promise<NormalizedItem> {
  const dir = join(outDir, 'norm');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${item.id}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as NormalizedItem;
  const response = await client.chat({
    stage: 'normalize',
    ref: item.id,
    provider: providerOf(NORMALIZE_MODEL),
    model: NORMALIZE_MODEL,
    temperature: 0,
    json: true,
    maxTokens: 6000,
    messages: [
      { role: 'system', content: NORMALIZE_SYSTEM },
      {
        role: 'user',
        content: `【章节】${item.chapter} ${item.section}\n【条目原文】\n${item.statement}\n\n【解答原文】\n${item.solution}`,
      },
    ],
  });
  if (response.finishReason === 'length') {
    const result: NormalizedItem = { itemId: item.id, usable: false, rejectReason: 'normalize_truncated', parts: [] };
    writeAtomic(file, `${JSON.stringify(result)}\n`);
    return result;
  }
  const raw = parseJsonLoose<{ usable?: boolean; rejectReason?: string | null; parts?: Array<{ no?: unknown; statement?: unknown; solution?: unknown }> }>(response.text);
  const parts = (raw.parts ?? [])
    .filter((part) => typeof part.statement === 'string' && typeof part.solution === 'string')
    .map((part, index, all) => ({
      partId: all.length === 1 ? item.id : `${item.id}-p${index + 1}`,
      no: part.no === undefined || part.no === null ? String(index + 1) : String(part.no),
      statement: (part.statement as string).trim(),
      solution: (part.solution as string).trim(),
    }));
  const usable = raw.usable === true && parts.length > 0;
  const result: NormalizedItem = {
    itemId: item.id,
    usable,
    ...(usable ? {} : { rejectReason: typeof raw.rejectReason === 'string' ? raw.rejectReason : 'normalize_unusable' }),
    parts: usable ? parts : [],
  };
  writeAtomic(file, `${JSON.stringify(result)}\n`);
  return result;
}

async function askVerifier(part: { partId: string; statement: string; solution: string }, client: ChatClient, stage: string): Promise<VerifyVerdict> {
  const response = await client.chat({
    stage,
    ref: part.partId,
    provider: providerOf(VERIFY_MODEL),
    model: VERIFY_MODEL,
    temperature: 0,
    thinking: true,
    json: true,
    maxTokens: 12000,
    messages: [
      { role: 'system', content: VERIFY_SYSTEM },
      { role: 'user', content: `【题面】\n${part.statement}\n\n【解答】\n${part.solution}` },
    ],
  });
  return parseVerdict(response.text);
}

// 校验 + 有条件修补：题面没问题、只是解答有洞时，让修补模型补，再由校验模型复核；复核不过就拒绝。
export async function verifyPart(part: NormalizedPart, itemId: string, client: ChatClient, outDir: string): Promise<VerifiedPart> {
  const dir = join(outDir, 'verify');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${part.partId}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as VerifiedPart;

  const first = await askVerifier(part, client, 'verify');
  let result: VerifiedPart = {
    partId: part.partId,
    itemId,
    statement: part.statement,
    solution: part.solution,
    accepted: verdictAccepted(first),
    repaired: false,
    verdict: first,
    verifierModel: VERIFY_MODEL,
    ...(verdictAccepted(first) ? {} : { reason: rejectionReason(first) }),
  };

  const repairable = !result.accepted && first.statementComplete && first.selfContained && first.gaps.length > 0;
  if (repairable) {
    const response = await client.chat({
      stage: 'repair',
      ref: part.partId,
      provider: providerOf(REPAIR_MODEL),
      model: REPAIR_MODEL,
      temperature: 0.1,
      json: true,
      maxTokens: 6000,
      messages: [
        { role: 'system', content: REPAIR_SYSTEM },
        {
          role: 'user',
          content: `【题面】\n${part.statement}\n\n【原解答】\n${part.solution}\n\n【审稿人指出的缺口】\n${first.gaps.map((gap) => `- ${gap}`).join('\n')}`,
        },
      ],
    });
    const repair = parseJsonLoose<{ repairable?: boolean; solution?: unknown }>(response.text);
    if (repair.repairable === true && typeof repair.solution === 'string' && repair.solution.trim() !== '') {
      const solution = repair.solution.trim();
      const second = await askVerifier({ partId: part.partId, statement: part.statement, solution }, client, 'verify-repair');
      if (verdictAccepted(second)) {
        result = { ...result, solution, accepted: true, repaired: true, verdict: second, firstVerdict: first };
        delete result.reason;
      } else {
        result = { ...result, verdict: second, firstVerdict: first, reason: `repair_rejected:${rejectionReason(second)}` };
      }
    } else {
      result = { ...result, reason: `unrepairable:${result.reason ?? ''}` };
    }
  }
  writeAtomic(file, `${JSON.stringify(result)}\n`);
  return result;
}

// 学生词汇：1–2 入门，3 进阶，4–5 挑战。与服务端的映射保持一致（练习区按它筛）。
export type Band = 'easy' | 'medium' | 'hard';

export function bandOf(difficulty: number): Band {
  if (difficulty <= 2) return 'easy';
  if (difficulty === 3) return 'medium';
  return 'hard';
}
