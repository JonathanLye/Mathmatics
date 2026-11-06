import type { ChatClient, ChatRequest, ChatResponse } from '../src/batch/llm.ts';
import { parseJsonLoose } from '../src/batch/llm.ts';

// 批量流水线测试用的自编小题（不含任何教辅原文）与假模型。
export function stemFor(letter: string): string {
  return `设 $${letter}>0$，用定义证明 $\\lim_{n\\to\\infty}\\frac{${letter}}{n}=0$。`;
}

export function solutionFor(letter: string): string {
  return [
    `任取 $\\varepsilon>0$，注意到 $\\left|\\frac{${letter}}{n}-0\\right|=\\frac{${letter}}{n}$。`,
    `取 $N=\\left[\\frac{${letter}}{\\varepsilon}\\right]+1$。`,
    `当 $n>N$ 时，$\\left|\\frac{${letter}}{n}-0\\right|=\\frac{${letter}}{n}<\\varepsilon$。`,
    `由极限的定义知 $\\lim_{n\\to\\infty}\\frac{${letter}}{n}=0$，结论得证。`,
  ].join('\n');
}

export function draftFor(letter: string): Record<string, unknown> {
  const frac = `\\frac{${letter}}{n}`;
  return {
    title: `用定义证明 ${letter}/n 趋于 0`,
    tags: ['ε-N', '放缩'],
    concepts: ['seq-limit', 'no-such-concept'],
    askChips: ['什么是充分条件？'],
    keys: [
      {
        id: 'K1',
        kind: 'core',
        label: '化简绝对值',
        deps: [],
        patterns: [`\\|${letter}/n(-0)?\\|`, `${letter}/n<ε`],
        examples: [`$\\left|${frac}-0\\right|=${frac}$`, `要使 $${frac}<\\varepsilon$`],
        leak: [`${letter}/n<ε`],
        hints: [
          '你要让哪个量小于 $\\varepsilon$？',
          '回到极限的定义，先写出要估计的绝对值。',
          '把这个绝对值化简成只含 $n$ 的式子。',
          '绝对值里减去 0 没有变化。',
          `$\\left|${frac}-0\\right|=${frac}$，要使 $${frac}<\\varepsilon$。下一行由你写：$n$ 要满足什么？`,
        ],
      },
      {
        id: 'K2',
        kind: 'core',
        label: '取 N',
        deps: ['K1'],
        patterns: [`N[=≥].{0,12}${letter}/ε`, `n>${letter}/ε`],
        examples: [`取 $N=\\left[\\frac{${letter}}{\\varepsilon}\\right]+1$`, `只要 $n>\\frac{${letter}}{\\varepsilon}$`],
        leak: [`${letter}/ε`],
        hints: [
          '$N$ 可以依赖哪些量？',
          '定义里 $N$ 在 $n$ 之前取定。',
          '把上一行关于 $n$ 的条件改写成只要 $N$ 够大。',
          '解出 $n$ 需要满足的下界。',
          `取 $N=\\left[\\frac{${letter}}{\\varepsilon}\\right]+1$。下一行由你写：对 $n>N$ 写出结论。`,
        ],
      },
      {
        id: 'K3',
        kind: 'formal',
        label: '收尾',
        deps: ['K1', 'K2'],
        patterns: ['n>N.{0,30}<ε', '当n>N时.{0,30}<ε'],
        examples: [`当 $n>N$ 时，$${frac}<\\varepsilon$`, `对 $n>N$ 有 $\\left|${frac}-0\\right|<\\varepsilon$`],
        leak: [],
        hints: [
          '最后要落到哪个不等式？',
          '收尾：对 $n>N$ 写出要证的不等式。',
          '把前面的不等式接成一条链。',
          '当 $n>N$ 时，链条最后小于 $\\varepsilon$。',
          `当 $n>N$ 时 $${frac}<\\varepsilon$。下一行由你写：写一句结论。`,
        ],
      },
    ],
    errors: [{ label: 'N 依赖 n', patterns: ['N=[^,;]*(?<![A-Za-z])n(?![A-Za-z])'], question: '你取的 $N$ 里出现了 $n$，它能依赖 $n$ 吗？' }],
    summaryPoints: [{ patterns: ['定义|放大|N'], question: '这题的关键一步是什么？' }],
    referenceProof: solutionFor(letter).split('\n'),
    walkthrough: {
      approach: '目标是让绝对值小于任意给定的 $\\varepsilon$。先化简，再由它解出 $n$ 的下界，就能定出 $N$。',
      keyIdeas: ['化简之后式子只含 $n$。', '$N$ 只能依赖 $\\varepsilon$。'],
      pitfalls: ['取的 $N$ 里出现了 $n$。'],
    },
  };
}

export interface StubOptions {
  // 按题面决定起草的回答；默认按字母给合格稿。
  draft?: (statement: string, attempt: number) => string;
  ocr?: (ref: string) => string;
  segment?: (request: ChatRequest) => string;
}

export interface StubClient extends ChatClient {
  calls: ChatRequest[];
  countOf(stage: string): number;
}

function userText(request: ChatRequest): string {
  const user = request.messages.find((message) => message.role === 'user');
  return typeof user?.content === 'string' ? user.content : '';
}

export function letterOf(statement: string): string {
  return /设 \$([a-z])>0\$/.exec(statement)?.[1] ?? 'a';
}

// 按阶段回答的假模型。约定：题面含“缺条件”时校验拒绝；解答含“有洞”时先报缺口，修补后通过；
// 解答含“修不好”时修补后仍不通过。
export function stubClient(options: StubOptions = {}): StubClient {
  const calls: ChatRequest[] = [];
  const draftAttempts = new Map<string, number>();
  const respond = (request: ChatRequest): string => {
    const content = userText(request);
    switch (request.stage) {
      case 'ocr':
        return options.ocr?.(request.ref ?? '') ?? `[页眉] 第二章 数列极限\n§1 数列极限概念\n1. ${stemFor('p')}\n证 ${solutionFor('p')}`;
      case 'segment':
        return options.segment?.(request) ?? '{"boundaries":[]}';
      case 'normalize': {
        const statement = /【条目原文】\n([\s\S]*?)\n\n【解答原文】/.exec(content)?.[1] ?? '';
        const solution = /【解答原文】\n([\s\S]*)$/.exec(content)?.[1] ?? '';
        const clean = statement.replace(/^(?:\d+[.．]|【[^】]*】)\s*/, '').trim();
        const proof = solution.replace(/^证明?\s*/, '').trim();
        return JSON.stringify({ usable: true, rejectReason: null, parts: [{ no: '1', statement: clean, solution: proof }] });
      }
      case 'verify':
      case 'verify-repair': {
        const hasGap = request.stage === 'verify' && /有洞|修不好/.test(content);
        const badAfterRepair = request.stage === 'verify-repair' && /修不好/.test(content);
        if (/缺条件/.test(content)) {
          return JSON.stringify({ statementComplete: false, selfContained: true, solutionProvesStatement: false, gaps: ['缺条件'], difficulty: 2, confidence: 0.9 });
        }
        if (hasGap || badAfterRepair) {
          return JSON.stringify({ statementComplete: true, selfContained: true, solutionProvesStatement: false, gaps: ['第二步没有依据'], difficulty: 3, confidence: 0.9 });
        }
        const difficulty = /[hjk]>0/.test(content) ? 4 : /[defg]>0/.test(content) ? 3 : 2;
        return JSON.stringify({ statementComplete: true, selfContained: true, solutionProvesStatement: true, gaps: [], difficulty, confidence: 0.95 });
      }
      case 'repair': {
        const letter = letterOf(content);
        const keep = /修不好/.test(content) ? '修不好\n' : '';
        return JSON.stringify({ repairable: true, solution: `${keep}${solutionFor(letter)}` });
      }
      case 'draft':
      case 'draft-repair': {
        const statement = /【题面】(.*)/.exec(content)?.[1] ?? '';
        const attempt = (draftAttempts.get(statement) ?? 0) + 1;
        draftAttempts.set(statement, attempt);
        return options.draft?.(statement, attempt) ?? JSON.stringify(draftFor(letterOf(statement)));
      }
      case 'variation': {
        const letter = letterOf(content);
        return JSON.stringify({
          lines: [`先看 $\\left|\\frac{${letter}}{n}\\right|$ 这个量。`, `令 $N=\\frac{${letter}}{\\varepsilon}$ 即可。`, '于是结论成立。'],
        });
      }
      default:
        throw new Error(`未知阶段 ${request.stage}`);
    }
  };
  return {
    calls,
    countOf: (stage: string) => calls.filter((call) => call.stage === stage).length,
    async chat(request: ChatRequest): Promise<ChatResponse> {
      calls.push(request);
      return {
        text: respond(request),
        finishReason: 'stop',
        usage: { input: 100, output: 100, cached: 0 },
        cost: 0.001,
        model: request.model,
      };
    },
  };
}

export { parseJsonLoose };
