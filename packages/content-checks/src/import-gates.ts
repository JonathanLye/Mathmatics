import { canon, splitMath, type ConceptsFile, type ProblemPackage } from '@proof-gym/engine';

import { checkCategories, type CheckIssue } from './index.ts';
import { replayReferenceProof, type ReplayResult } from './replay.ts';

// 批量导入题的附加门禁（U16：不经人工审核，全靠这些检查）。不过的题进失败报告，绝不发布。

// 空话：这些行不含任何数学内容，任何关键步骤的模式都不该命中。
const GENERIC_LINES = [
  '证明',
  '证明：',
  '证：',
  '由题意',
  '由题意可知',
  '由已知条件可得',
  '因为',
  '所以',
  '因此',
  '于是',
  '显然成立',
  '所以结论成立',
  '因此命题得证',
  '由定义可知',
  '证毕',
  '得证',
  '下面证明',
  '根据定理',
];

const GENERIC_TITLE = /^(?:证明题?|习题|例题|练习|数学分析|题目)\s*\d*$/;

const IMPORT_LAYERS = { L1: false, L2: false, L3: true, L4: false, L5: false, L6: true } as const;

function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'u');
  } catch {
    return null;
  }
}

function isBalancedMath(text: string): boolean {
  let open = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === '$') open = !open;
  }
  return !open;
}

function mathTextFields(pkg: ProblemPackage): Array<[string, string]> {
  const S = pkg.secret;
  const fields: Array<[string, string]> = [['public.stem', pkg.public.stem]];
  for (const key of S.keys) {
    for (const hint of key.hints) fields.push([`${key.id}.${hint.level}`, hint.text]);
    for (const [index, example] of (key.examples ?? []).entries()) fields.push([`${key.id}.examples[${index}]`, example]);
  }
  for (const error of S.errors) fields.push([`errors.${error.id}.question`, error.question]);
  for (const point of S.summaryPoints) fields.push([`summary.${point.id}.question`, point.question]);
  for (const proof of S.referenceProofs ?? []) fields.push([`referenceProofs.${proof.id}`, proof.text]);
  const walkthrough = S.walkthrough;
  if (walkthrough !== undefined) {
    fields.push(['walkthrough.approach', walkthrough.approach]);
    walkthrough.keyIdeas.forEach((text, index) => fields.push([`walkthrough.keyIdeas[${index}]`, text]));
    (walkthrough.pitfalls ?? []).forEach((text, index) => fields.push([`walkthrough.pitfalls[${index}]`, text]));
  }
  return fields;
}

export function importStructureIssues(pkg: ProblemPackage): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const P = pkg.public;
  const S = pkg.secret;

  if (GENERIC_TITLE.test(P.title.trim())) issues.push({ where: 'public.title', message: `标题太笼统：${P.title}` });
  for (const [layer, enabled] of Object.entries(IMPORT_LAYERS)) {
    if (P.layers[layer as 'L1'].enabled !== enabled) {
      issues.push({ where: `public.layers.${layer}`, message: `导入题只启用 L3 与 L6，${layer} 应为 ${String(enabled)}` });
    }
  }

  // 引擎的 nextKey 要求每条路线都走完才算闭合，所以导入题只用一条路线，别的证法写进模式里。
  if (S.routes.length !== 1) issues.push({ where: 'secret.routes', message: `导入题只允许一条路线，实际 ${S.routes.length} 条` });
  const routed = new Set(S.routes.flat());
  for (const key of S.keys) {
    if (!routed.has(key.id)) issues.push({ where: 'secret.routes', message: `${key.id} 不在路线里，学生写出它也不算推进` });
  }

  const walkthrough = S.walkthrough;
  if (walkthrough === undefined) {
    issues.push({ where: 'secret.walkthrough', message: '导入题必须带解题思路与关键点' });
  } else {
    if (walkthrough.approach.trim().length < 10) issues.push({ where: 'walkthrough.approach', message: '解题思路太短' });
    if (walkthrough.keyIdeas.length < 1 || walkthrough.keyIdeas.length > 5) {
      issues.push({ where: 'walkthrough.keyIdeas', message: `关键点应为 1–5 条，实际 ${walkthrough.keyIdeas.length}` });
    }
  }

  for (const [where, text] of mathTextFields(pkg)) {
    if (!isBalancedMath(text)) issues.push({ where, message: `$ 不成对：${text.slice(0, 80)}` });
    if (text.includes('$$')) issues.push({ where, message: 'MathText 不允许 $$，只用行内 $...$' });
    // 换页符、退格：模型把 \frac、\beta 只写一个反斜杠，JSON 解析后悄悄变成控制字符，KaTeX 也不报错。
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) issues.push({ where, message: `含控制字符，公式已损坏：${text.slice(0, 80)}` });
    if (text.includes('⍰')) issues.push({ where, message: `含 OCR 不可辨认字符：${text.slice(0, 80)}` });
    if (/\[图\]/.test(text)) issues.push({ where, message: '依赖图形' });
    if (/\*\*|^#{1,6}\s/m.test(text)) issues.push({ where, message: `含 Markdown 记号：${text.slice(0, 80)}` });
    // 中文写进公式会按数学斜体渲染、间距全乱，KaTeX 也不报错。\text{...} 里的中文是对的。
    const inMath = splitMath(text).filter((part) => part.math).map((part) => part.s.replace(/\\(?:text|mbox|textrm|mathrm)\s*\{[^{}]*\}/g, ''));
    if (inMath.some((math) => /[一-鿿]/.test(math))) {
      issues.push({ where, message: `中文写进了公式，要放到 $ 外面（写“假设 $x>0$”，不写“$假设 x>0$”）：${text.slice(0, 80)}` });
    }
  }

  for (const hint of S.keys.flatMap((key) => key.hints)) {
    if (hint.level === 'H4' && hint.handsBack !== true) issues.push({ where: 'hints.H4', message: 'H4 必须把下一行交还学生（handsBack）' });
  }
  for (const error of S.errors) {
    if (/[错对]了|不对|错误/.test(error.question) && !/[？?]/.test(error.question)) {
      issues.push({ where: `errors.${error.id}.question`, message: `批注只能是问句：${error.question}` });
    }
  }
  return issues;
}

export function patternQualityIssues(pkg: ProblemPackage): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const stem = canon(pkg.public.stem);
  for (const key of pkg.secret.keys) {
    const where = `${key.id}.patterns`;
    if (key.patterns.length < 2) issues.push({ where, message: '每个关键步骤至少两条模式，覆盖自然写法的差异' });
    if ((key.examples ?? []).length < 2) issues.push({ where: `${key.id}.examples`, message: '每个关键步骤至少两条学生式样例' });
    for (const pattern of key.patterns) {
      const compiled = compile(pattern);
      if (compiled === null) continue; // 正则不合法由 S8 报告
      if (compiled.test('') || compiled.test('a')) {
        issues.push({ where, message: `模式太宽，空行也能命中：${pattern}` });
        continue;
      }
      const generic = GENERIC_LINES.find((line) => compiled.test(canon(line)));
      if (generic !== undefined) issues.push({ where, message: `模式命中了没有数学内容的空话“${generic}”：${pattern}` });
      if (key.kind === 'core' && compiled.test(stem)) {
        issues.push({ where, message: `核心步骤的模式命中了题面，抄题就能得分：${pattern}` });
      }
    }
  }
  return issues;
}

// H2 只指方向：不能带可以照抄进证明的式子（题面里已有的除外）。
// |x-x_0|、lim f(x) 这种记号本身不算“步骤”：要带关系符或者足够长，才是可以抄进证明的东西。
export function copyableFragments(hintText: string, stemCanon: string, exampleCanon: readonly string[]): string[] {
  const fragments: string[] = [];
  for (const part of splitMath(hintText)) {
    if (!part.math) continue;
    const fragment = canon(`$${part.s}$`);
    if (fragment.length < 6 || stemCanon.includes(fragment)) continue;
    if (!/[=<>≤≥≠→⇒]/.test(fragment) && fragment.length < 12) continue;
    if (exampleCanon.some((example) => example.includes(fragment))) fragments.push(fragment);
  }
  return fragments;
}

export function hintFragmentIssues(pkg: ProblemPackage): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const stem = canon(pkg.public.stem);
  for (const key of pkg.secret.keys) {
    const h2 = key.hints.find((hint) => hint.level === 'H2');
    if (h2 === undefined) continue;
    const exampleCanon = (key.examples ?? []).map((example) => canon(example));
    for (const fragment of copyableFragments(h2.text, stem, exampleCanon)) {
      issues.push({ where: `${key.id}.H2`, message: `H2 含可照抄的片段：${fragment}` });
    }
  }
  return issues;
}

// 片段必须是真能照写的东西：太短会让引用题面或通用符号的提示都被拦下。
export function leakSanityIssues(pkg: ProblemPackage, replay: ReplayResult): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const proofCanon = replay.lines.map((line) => line.canon).join('\n');
  for (const key of pkg.secret.keys) {
    for (const fragment of key.leak) {
      if (canon(fragment).length < 3) issues.push({ where: `${key.id}.leak`, message: `片段太短：${fragment}` });
    }
    if (key.leak.length > 0) {
      const texts = [proofCanon, ...(key.examples ?? []).map((example) => canon(example))];
      const seen = key.leak.some((fragment) => texts.some((text) => text.includes(canon(fragment)) || text.includes(fragment)));
      if (!seen) issues.push({ where: `${key.id}.leak`, message: '所有片段都没有在样例或参考证明里出现，泄题拦截形同虚设' });
    }
  }
  // 纯文字的步骤（如“用反证法”）可以没有片段；但全题大多数核心步骤都没有，就等于没有防泄题。
  const core = pkg.secret.keys.filter((key) => key.kind === 'core');
  const guarded = core.filter((key) => key.leak.length > 0);
  if (core.length > 0 && guarded.length * 2 < core.length) {
    issues.push({ where: 'secret.keys.leak', message: `${core.length} 个核心步骤只有 ${guarded.length} 个列了可照写的片段，至少要一半` });
  }
  return issues;
}

export interface ImportGateResult {
  ok: boolean;
  issues: CheckIssue[];
  replay: ReplayResult;
  categories: ReturnType<typeof checkCategories>['categories'];
}

export function runImportGates(pkg: ProblemPackage, concepts?: ConceptsFile): ImportGateResult {
  const s8 = checkCategories(pkg, concepts === undefined ? {} : { concepts });
  if (!s8.categories.schema) {
    return {
      ok: false,
      issues: s8.issues,
      categories: s8.categories,
      replay: { ok: false, issues: [], lines: [], matched: [], missing: [], canFinish: false, completed: false },
    };
  }
  const structure = importStructureIssues(pkg);
  const patterns = patternQualityIssues(pkg);
  const hints = hintFragmentIssues(pkg);
  let replay: ReplayResult;
  try {
    replay = replayReferenceProof(pkg, concepts);
  } catch (error) {
    replay = {
      ok: false,
      issues: [{ where: 'replay', message: `回放异常：${(error as Error).message}` }],
      lines: [],
      matched: [],
      missing: [],
      canFinish: false,
      completed: false,
    };
  }
  const leak = leakSanityIssues(pkg, replay);
  const issues = [...s8.issues, ...structure, ...patterns, ...hints, ...replay.issues, ...leak];
  return { ok: issues.length === 0, issues, replay, categories: s8.categories };
}
