import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import {
  hintFragmentIssues,
  importStructureIssues,
  leakSanityIssues,
  patternQualityIssues,
  replayProofLines,
  replayReferenceProof,
  runImportGates,
  splitProofLines,
} from '../src/index.ts';

function seed(name = 'epsN'): ProblemPackage {
  const path = fileURLToPath(import.meta.resolve(`@proof-gym/contracts/seed/${name}.json`));
  return JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage;
}

function hints(texts: string[]): ProblemPackage['secret']['keys'][number]['hints'] {
  const levels = ['H0', 'H1', 'H2', 'H3', 'H4'] as const;
  const costs = [0, 0, 0.5, 1, 1] as const;
  return levels.map((level, index) => ({
    level,
    text: texts[index] as string,
    cost: costs[index] as 0 | 0.5 | 1,
    ...(level === 'H4' ? { handsBack: true } : {}),
  }));
}

// 导入题形状的自编小题：a/n 趋于 0。
function imported(): ProblemPackage {
  const off = { enabled: false };
  return {
    schemaVersion: '1.0',
    id: 'imp-test',
    version: 1,
    kind: 'main',
    public: {
      title: '用定义证明 a/n 趋于 0',
      stem: '设 $a>0$，用定义证明 $\\lim_{n\\to\\infty}\\frac{a}{n}=0$。',
      chapter: '第二章 数列极限',
      difficulty: 2,
      role: 'optional',
      layers: { L1: off, L2: off, L3: { enabled: true }, L4: off, L5: off, L6: { enabled: true } },
      keyCount: 2,
      budget: { reveal: 2 },
    },
    secret: {
      keys: [
        {
          id: 'K1',
          kind: 'core',
          label: '取 N',
          patterns: ['N[=≥].{0,12}a/ε', 'n>a/ε'],
          examples: ['取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$', '只要 $n>\\frac{a}{\\varepsilon}$'],
          leak: ['a/ε'],
          hints: hints(['$N$ 依赖什么？', '$N$ 只依赖 $\\varepsilon$。', '从目标解出 $n$ 的下界。', '解出 $n$。', '取 $N=\\frac{a}{\\varepsilon}$。下一行由你写。']),
        },
        {
          id: 'K2',
          kind: 'formal',
          label: '收尾',
          deps: ['K1'],
          patterns: ['n>N.{0,30}<ε', '当n>N时.{0,30}<ε'],
          examples: ['当 $n>N$ 时，$\\frac{a}{n}<\\varepsilon$', '对 $n>N$ 有 $\\left|\\frac{a}{n}\\right|<\\varepsilon$'],
          leak: [],
          hints: hints(['最后落到哪里？', '写出不等式。', '接成一条链。', '当 $n>N$ 时小于 $\\varepsilon$。', '写出结论。下一行由你写。']),
        },
      ],
      routes: [['K1', 'K2']],
      errors: [],
      allowedTheorems: [],
      forbiddenTheorems: [],
      selfcheckBank: [],
      summaryPoints: [{ id: 'S1', patterns: ['定义'], question: '关键是什么？' }],
      referenceProofs: [
        {
          id: 'P1',
          route: 0,
          text: '任取 $\\varepsilon>0$，取 $N=\\left[\\frac{a}{\\varepsilon}\\right]+1$。\n当 $n>N$ 时，$\\frac{a}{n}<\\varepsilon$。',
          publishable: true,
        },
      ],
      walkthrough: { approach: '让绝对值小于任意给定的 ε，由此解出 N 的取法。', keyIdeas: ['$N$ 只依赖 $\\varepsilon$。'], pitfalls: [] },
    },
    review: { status: 'published' },
  } as ProblemPackage;
}

describe('splitProofLines', () => {
  it('按换行和公式外的句号、分号切；公式内部不切', () => {
    expect(splitProofLines('第一句。第二句；第三句\n\n第四句')).toEqual(['第一句。', '第二句；', '第三句', '第四句']);
    expect(splitProofLines('因为 $a。b$ 所以 $c$')).toEqual(['因为 $a。b$ 所以 $c$']);
    expect(splitProofLines('价格 \\$5。然后')).toEqual(['价格 \\$5。', '然后']);
  });
});

describe('replayReferenceProof', () => {
  it('合格的导入题能走到完成', () => {
    const result = replayReferenceProof(imported());
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({ ok: true, canFinish: true, completed: true, missing: [] });
    expect(result.matched.sort()).toEqual(['K1', 'K2']);
    expect(result.lines[0]?.keys).toEqual(['K1']);
  });

  it('抓到走不通的题：模式与参考证明对不上', () => {
    const pkg = imported();
    (pkg.secret.keys[0] as { patterns: string[] }).patterns = ['不可能命中'];
    const result = replayReferenceProof(pkg);
    expect(result.ok).toBe(false);
    expect(result.canFinish).toBe(false);
    expect(result.missing).toEqual(['K1']);
    expect(result.issues.map((issue) => issue.where)).toContain('replay.K1');
  });

  it('错误模式截走参考证明的某一行也算不过', () => {
    const pkg = imported();
    pkg.secret.errors = [{ id: 'E1', label: '太宽', patterns: ['取N'], question: '这样取可以吗？' }];
    const result = replayReferenceProof(pkg);
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatchObject({ cls: 'error', errorId: 'E1' });
  });

  it('没有参考证明直接不过', () => {
    const pkg = imported();
    pkg.secret.referenceProofs = [];
    expect(replayReferenceProof(pkg).ok).toBe(false);
  });

  it('三步以上的题不能一行写完全部关键步骤', () => {
    const pkg = imported();
    const third = structuredClone(pkg.secret.keys[1]) as ProblemPackage['secret']['keys'][number];
    third.id = 'K3';
    (pkg.secret.keys as unknown[]).push(third);
    pkg.secret.routes = [['K1', 'K2', 'K3']];
    pkg.public.keyCount = 3;
    pkg.secret.referenceProofs[0]!.text = '取 $N=\\frac{a}{\\varepsilon}$，当 $n>N$ 时 $\\frac{a}{n}<\\varepsilon$。';
    const result = replayReferenceProof(pkg);
    expect(result.issues.map((issue) => issue.where)).toContain('replay.lines');
  });

  it('带前置层的种子题也能回放（只走第 3 层）', () => {
    const series = seed('series');
    const result = replayProofLines(series, splitProofLines(series.secret.referenceProofs[0]?.text ?? ''));
    expect(result.canFinish).toBe(true);
    expect(result.missing).toEqual([]);
  });
});

describe('导入门禁', () => {
  it('合格的题全部通过', () => {
    const result = runImportGates(imported());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.categories).toEqual({ schema: true, katex: true, leakExhaustive: true, patternSelfTest: true });
  });

  it('schema 不合格时直接返回，不抛异常', () => {
    const result = runImportGates({} as ProblemPackage);
    expect(result.ok).toBe(false);
    expect(result.categories.schema).toBe(false);
  });

  it('结构：缺解题思路、多条路线、层不对、$ 不成对、OCR 残字、笼统标题', () => {
    const pkg = imported();
    delete pkg.secret.walkthrough;
    pkg.secret.routes = [['K1', 'K2'], ['K1']];
    pkg.public.layers.L4 = { enabled: true };
    pkg.public.title = '证明题';
    pkg.secret.keys[0]!.hints[0]!.text = '不成对 $a';
    pkg.secret.referenceProofs[0]!.text = '这里有 ⍰ 残字';
    const messages = importStructureIssues(pkg).map((issue) => `${issue.where} ${issue.message}`).join('\n');
    expect(messages).toContain('secret.walkthrough');
    expect(messages).toContain('只允许一条路线');
    expect(messages).toContain('public.layers.L4');
    expect(messages).toContain('标题太笼统');
    expect(messages).toContain('$ 不成对');
    expect(messages).toContain('OCR');
  });

  it('结构：公式里的控制字符（单反斜杠被 JSON 吃掉）', () => {
    const pkg = imported();
    pkg.secret.keys[0]!.hints[3]!.text = '$\frac{1}{2}$';
    expect(importStructureIssues(pkg).map((issue) => issue.message).join()).toContain('控制字符');
  });

  it('结构：中文写进公式（\\text 里的中文可以）', () => {
    const pkg = imported();
    pkg.secret.keys[0]!.examples = ['$假设 a \\ne b$', '$a=\\text{有理数}$'];
    const messages = importStructureIssues(pkg).map((issue) => `${issue.where} ${issue.message}`);
    expect(messages.filter((message) => message.includes('中文写进了公式'))).toHaveLength(1);
    expect(messages.join()).toContain('K1.examples[0]');
  });

  it('模式：太宽、命中空话、核心步骤命中题面、数量不足', () => {
    const pkg = imported();
    pkg.secret.keys[0]!.patterns = ['.*'];
    let messages = patternQualityIssues(pkg).map((issue) => issue.message).join('\n');
    expect(messages).toContain('空行也能命中');
    expect(messages).toContain('至少两条');

    pkg.secret.keys[0]!.patterns = ['所以', 'lim_'];
    messages = patternQualityIssues(pkg).map((issue) => issue.message).join('\n');
    expect(messages).toContain('空话');
    expect(messages).toContain('抄题就能得分');

    // formal 步骤（如最后一句结论）可以和题面重合
    const formal = imported();
    formal.secret.keys[1]!.patterns = ['a/n', '当n>N时.{0,30}<ε'];
    expect(patternQualityIssues(formal)).toEqual([]);
  });

  it('H2 不能带可以照抄的式子（题面已有的除外）', () => {
    const pkg = imported();
    pkg.secret.keys[0]!.examples = ['取 $N=\\frac{a}{\\varepsilon}+1$', '只要 $n>\\frac{a}{\\varepsilon}$'];
    pkg.secret.keys[0]!.hints[2]!.text = '试试 $N=\\frac{a}{\\varepsilon}+1$ 这样的形式。';
    expect(hintFragmentIssues(pkg)[0]?.message).toContain('H2');
    pkg.secret.keys[0]!.hints[2]!.text = '回到题面的 $\\lim_{n\\to\\infty}\\frac{a}{n}=0$。';
    expect(hintFragmentIssues(pkg)).toEqual([]);
  });

  it('片段：太短、核心步骤没有片段、片段哪儿都没出现', () => {
    const pkg = imported();
    const replay = replayReferenceProof(pkg);
    pkg.secret.keys[0]!.leak = ['n'];
    expect(leakSanityIssues(pkg, replay).map((issue) => issue.message).join()).toContain('太短');
    pkg.secret.keys[0]!.leak = [];
    expect(leakSanityIssues(pkg, replay).map((issue) => issue.message).join()).toContain('至少要一半');
    pkg.secret.keys[0]!.leak = ['q/w=z'];
    expect(leakSanityIssues(pkg, replay).map((issue) => issue.message).join()).toContain('形同虚设');
  });

  it('门禁汇总里包含回放结果', () => {
    const pkg = imported();
    (pkg.secret.keys[0] as { patterns: string[] }).patterns = ['不可能命中甲', '不可能命中乙'];
    pkg.secret.keys[0]!.examples = [];
    const result = runImportGates(pkg);
    expect(result.ok).toBe(false);
    expect(result.replay.missing).toEqual(['K1']);
  });
});
