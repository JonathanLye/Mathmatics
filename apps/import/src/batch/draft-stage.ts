import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyableFragments, runImportGates, splitProofLines, type CheckIssue, type ImportGateResult } from '@proof-gym/content-checks';
import { canon, splitMath, type ConceptsFile, type ProblemPackage } from '@proof-gym/engine';

import { parseJsonLoose, providerOf, type ChatClient, type ChatMessage } from './llm.ts';
import { writeAtomic } from './ocr-stage.ts';
import type { SegmentedItem } from './segment.ts';
import { bandOf, type VerifiedPart } from './verify.ts';

// S6 起草：模型只写需要判断力的部分（关键步骤、提示、解题思路），结构字段由这里按规则组装，
// 省去大量无意义的校验失败。校验错误（含每一行的 canon 结果）回喂模型，最多重试两次。
export const DRAFT_MODEL = 'deepseek-flash';
// 缓存里没有 draftModel 的起草结果，都是切换到 deepseek-flash 之前由这个模型写的。
const LEGACY_DRAFTER = 'deepseek-v4-pro';
export const PROMPT_VERSION = 'imp-5';
const MAX_ATTEMPTS = 3;

export interface RawDraft {
  title?: unknown;
  tags?: unknown;
  concepts?: unknown;
  keys?: unknown;
  errors?: unknown;
  summaryPoints?: unknown;
  askChips?: unknown;
  referenceProof?: unknown;
  walkthrough?: unknown;
}

function contractPath(rel: string): string {
  return fileURLToPath(import.meta.resolve(`@proof-gym/contracts/${rel}`));
}

function schemaExcerpt(): string {
  const schema = JSON.parse(readFileSync(contractPath('problem-package.schema.json'), 'utf8')) as {
    $defs: Record<string, { properties?: Record<string, unknown> }>;
  };
  const defs = schema.$defs;
  const trimmed = {
    KeyStep: defs.KeyStep,
    Hint: defs.Hint,
    ErrorPattern: defs.ErrorPattern,
    SummaryPoint: defs.SummaryPoint,
    walkthrough: defs.SecretPart?.properties?.walkthrough,
  };
  return JSON.stringify(trimmed);
}

function seedExample(): string {
  const seed = JSON.parse(readFileSync(contractPath('seed/epsN.json'), 'utf8')) as ProblemPackage;
  const S = seed.secret;
  const example = {
    title: seed.public.title,
    tags: seed.public.tags,
    concepts: seed.public.concepts,
    askChips: seed.public.askChips,
    keys: S.keys.map((key) => ({
      id: key.id,
      kind: key.kind,
      label: key.label,
      deps: key.deps,
      patterns: key.patterns,
      examples: key.examples,
      leak: key.leak,
      jev: key.jev,
      hints: key.hints.map((hint) => hint.text),
    })),
    errors: S.errors,
    summaryPoints: S.summaryPoints,
    referenceProof: splitProofLines(S.referenceProofs[0]?.text ?? ''),
    walkthrough: {
      approach:
        '目标是让 $|a_n-3|$ 小于任意给定的 $\\varepsilon$。先把它化简成只含 $n$ 的式子，再放大成便于解 $n$ 的形式，由此定出 $N$。',
      keyIdeas: [
        '通分化简：$|a_n-3|$ 是一个只含 $n$ 的简单分式。',
        '放大：不需要解出精确范围，把分母变小得到更简单的上界就够了。',
        '$N$ 只能依赖 $\\varepsilon$，由上一步的充分条件写出。',
      ],
      pitfalls: ['取的 $N$ 里出现了 $n$。', '放大时不等号方向弄反。'],
    },
  };
  return JSON.stringify(example);
}

export function draftSystemPrompt(concepts: ConceptsFile): string {
  const conceptList = (concepts.concepts as Array<{ id: string; title?: string }>).map((concept) => `${concept.id}（${concept.title ?? ''}）`).join('、');
  return [
    '你在为“数学分析证明写作陪练”编写题目包。学生自己一行一行写证明，系统按正则判断他写出了哪些关键步骤，只给预写的分级提示，绝不替学生写。',
    '给你题面和一份已核验的证明。题面不用你改。你输出 JSON（json），字段见最后的样例。',
    '',
    '【关键步骤 keys】3–5 个（简单题可以 2 个，最多 6 个），每个是“写出来就推进了证明”的一步，顺序就是证明的顺序。kind：core 是解题核心，formal 是只依赖命题形式的固定动作（如“任取 ε>0”、最后一句结论）。至少一半是 core。',
    '',
    '【patterns：最容易出错，务必看懂】每个关键步骤至少 2 条，是作用在 canon(学生那一行) 上的 JS 正则（u 标志）。canon 的规则：',
    '- 去掉所有空白；\\frac{a}{b} → a/b，分子有加减时加括号 (a+b)/c，分母不是单个数或字母时加括号 a/(b+c)；\\sqrt{x} → √x，复杂时 √(x+1)；',
    '- \\varepsilon → ε，\\delta → δ，\\leqslant/\\le → ≤，\\geqslant/\\ge → ≥，\\ne → ≠，\\to → →，\\Rightarrow → ⇒，\\forall → ∀，\\exists → ∃，\\in → ∈，\\infty → ∞，\\cdot/\\times → *，\\sum → ∑，\\int → ∫，\\lim → lim，\\sin → sin；',
    '- 下标上标：x_{0} → x_0，x_{n+1} → x_(n+1)，x^{2} → x^2，\\lim_{n\\to\\infty} → lim_(n→∞)；\\left \\right \\, 都去掉；全角标点转半角（，→ ,  ；→ ;  （ → (）；中文原样保留。',
    '例：$\\left|\\frac{1}{n}-0\\right|<\\varepsilon$ 的 canon 是 |1/n-0|<ε；$x_{n+1}\\geqslant x_{n}$ 的 canon 是 x_(n+1)≥x_n。',
    '写模式的要领：',
    '- 抓这一步“非写不可”的数学内容，不要抓整句。比如取 δ 这一步抓 δ=.*ε/2 或 δ=min，而不是整行等式。学生可能换字母的地方（如 a_n 与 x_n）用字符类，顺序可变的写两条。',
    '- 允许自然写法差异：用 .{0,8} 隔开前后两部分；同一内容的中文说法也写一条（如 “局部保号|保号性”，“单调递增|递增”，“有界”）。',
    '- 正则元字符要转义：\\( \\) \\| \\^ \\+ \\* \\. \\[ \\]，在 JSON 里写成双反斜杠 "\\\\("。绝对值的竖线一定要转义：|x| 写成 \\\\|x\\\\|。不要写 LaTeX 命令（模式里不能出现 \\\\frac、\\\\varepsilon），不要写空格，不要用 (?i)，不要写英文。',
    '- 不能太宽：不能匹配“证明”“所以结论成立”这种空话，也不要只写“矛盾”这种一个词；core 步骤的模式不能匹配题面本身（否则抄题就得分），带式子的步骤至少一条模式抓式子。',
    '- 用户消息里给了已核验证明每一行的 canon 结果，模式要对着它写，写完自己核对一遍。',
    '',
    '【proofLine】每步写一个数字：referenceProof 里实现这一步的行号（从 1 开始）。',
    '',
    '【examples】每步至少 2 条学生式写法（MathText，用 $...$），必须能被本步骤的 patterns 命中。写具体的数学内容，不要写“故原不等式成立”这种空话。',
    '',
    '【leak】可以直接照写的公式片段，写 canon 形式（如 5/(n+2)、N=⌈5/ε⌉），包括等价变体；每条不少于 3 个字符，不要写中文句子（“x为有理数”这种会误拦提示）；不能是题面的一部分。纯文字的步骤（如“用反证法”）可以不写 leak，其余 core 步骤至少一条，并且要真的出现在 examples 或 referenceProof 里。',
    '',
    '【hints】每步 5 条字符串，按 H0、H1、H2、H3、H4 的顺序，文本开头不要写“H0:”这样的标记：',
    '- H0 只追问（只问问题，不含式子结论）；H1 只讲定义或框架；H2 指方向但不给对象（可以点名要用的定理），不能出现可以抄进证明的式子，不含本步 leak；',
    '- H3 给出这一步的一半；H4 示范这一步的完整一行，并以“下一行由你写”这类句式把下一行交还学生；',
    '- H0、H1、H2 不得包含本步及后续步骤的 leak；H3、H4 不得包含后续步骤的 leak。提示里的式子要和 leak 对照检查。',
    '',
    '【errors】0–3 条常见错误（确实常见才写），patterns 只匹配错误写法；question 是一句追问，只问不判，不说“错”。没有把握就给空数组。',
    '【summaryPoints】2–3 条，question 问学生这题的关键是什么，patterns 匹配回答里的关键词。',
    '【askChips】2–3 个学生可能想问的短句（30 字内）。',
    '',
    '【referenceProof】字符串数组，每个元素是一行，把已核验的证明按学生的写法拆成若干行（一行一步，每个关键步骤都要有一行能被它的 patterns 命中，一行不要塞多个关键步骤）。内容必须来自已核验的证明，可以规范表述，不得改变数学内容。不要加行号。',
    '',
    '【walkthrough】给学生看的解题讲解，用通顺的中文：approach 讲解题思路（2–4 句，为什么这么想，从哪里入手），keyIdeas 1–5 条讲关键点（每条一句话），pitfalls 0–4 条讲易错点。不要照抄证明。',
    '',
    '【title】60 字以内，具体说明这题证什么（如“单调有界证明递推数列收敛”），不要写“证明题”。【tags】2–5 个方法或主题词。【concepts】只能从概念表里选，没有合适的就给空数组。',
    '',
    '所有 MathText 里数学式写在 $...$ 内，不用 $$，一对 $ 不跨行，不用 Markdown 记号。中文一律写在 $ 外面：写“假设 $ax$ 为有理数”，不要写“$假设 ax 为有理数$”。',
    '',
    `概念表：${conceptList}`,
    '',
    `字段的 JSON Schema（节选，hints 你只需写 5 条字符串，其余结构字段由系统补）：${schemaExcerpt()}`,
    '',
    `样例（已审核的题目）：${seedExample()}`,
    '',
    '只输出一个 JSON 对象，字段：title、tags、concepts、askChips、keys、errors、summaryPoints、referenceProof、walkthrough。',
  ].join('\n');
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

// canon 之后的文本里没有 LaTeX 命令，模型写进模式的命令按 canon 的映射换成符号。
const PATTERN_LATEX: Array<[RegExp, string]> = [
  [/\\(?:varepsilon|epsilon)(?![A-Za-z])/g, 'ε'],
  [/\\delta(?![A-Za-z])/g, 'δ'],
  [/\\xi(?![A-Za-z])/g, 'ξ'],
  [/\\eta(?![A-Za-z])/g, 'η'],
  [/\\alpha(?![A-Za-z])/g, 'α'],
  [/\\beta(?![A-Za-z])/g, 'β'],
  [/\\lambda(?![A-Za-z])/g, 'λ'],
  [/\\(?:leqslant|leq|le)(?![A-Za-z])/g, '≤'],
  [/\\(?:geqslant|geq|ge)(?![A-Za-z])/g, '≥'],
  [/\\(?:neq|ne)(?![A-Za-z])/g, '≠'],
  [/\\(?:to|rightarrow)(?![A-Za-z])/g, '→'],
  [/\\(?:Rightarrow|implies)(?![A-Za-z])/g, '⇒'],
  [/\\infty(?![A-Za-z])/g, '∞'],
  [/\\forall(?![A-Za-z])/g, '∀'],
  [/\\exists(?![A-Za-z])/g, '∃'],
  [/\\in(?![A-Za-z])/g, '∈'],
  [/\\(?:cdot|times)(?![A-Za-z])/g, '\\*'],
  [/\\sum(?![A-Za-z])/g, '∑'],
  [/\\int(?![A-Za-z])/g, '∫'],
  [/\\sqrt(?![A-Za-z])/g, '√'],
  [/\\(lim|sup|inf|max|min|sin|cos|tan|ln|log|exp|arctan)(?![A-Za-z])/g, '$1'],
];
// 还留着这些命令的模式不可能命中 canon 文本（\frac 甚至是合法正则：换页符 + rac）。
const LEFTOVER_LATEX = /\\(?:d?frac|tfrac|left|right|mathbb|mathbf|mathrm|operatorname|partial|geqslant|leqslant|lVert|rVert)(?![A-Za-z])/;

// 模型常犯的写法问题：能确定意思的直接修，修不了的留给门禁报告。
export function fixPattern(pattern: string): string {
  let fixed = pattern.replace(/^\(\?[a-z]+\)/, '');
  for (const [regex, replacement] of PATTERN_LATEX) fixed = fixed.replace(regex, replacement);
  fixed = fixed.replace(/ /g, '').replace(/\\s[*+?]?/g, '');
  if (!compiles(fixed)) {
    const unescaped = fixed.replace(/\\([_,:;<>=%&~'"!@#`-])/g, '$1');
    return compiles(unescaped) ? unescaped : fixed;
  }
  // 绝对值的竖线忘了转义时，“||x|” 变成空分支，什么都能命中。
  if (new RegExp(fixed, 'u').test('')) {
    const escaped = fixed.replace(/(?<!\\)\|/g, '\\|');
    if (compiles(escaped) && !new RegExp(escaped, 'u').test('')) return escaped;
  }
  return fixed;
}

function usablePattern(pattern: string): boolean {
  return pattern !== '' && compiles(pattern) && !LEFTOVER_LATEX.test(pattern) && !new RegExp(pattern, 'u').test('');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesAnyPattern(patterns: readonly string[], text: string): boolean {
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, 'u').test(text);
    } catch {
      return false;
    }
  });
}

function mathPartsOf(text: string): string[] {
  return splitMath(text)
    .filter((part) => part.math)
    .map((part) => canon(`$${part.s}$`));
}

const RELATION = /[=<>≤≥≠→⇒]/;

// 给一行学生式写法补一条字面模式：式子够具体就只抓式子（换种说法也能命中），否则抓整行。
// 只会多认这一种写法，不会变宽；纯文字的核心步骤不补，那种模式要由模型写。
function literalPatternFor(line: string, kind: 'core' | 'formal', stemCanon: string): string | null {
  const full = canon(line);
  const parts = mathPartsOf(line);
  const specific = parts
    .filter((text) => text.length >= 8 && RELATION.test(text) && full.includes(text))
    .sort((a, b) => b.length - a.length)[0];
  const literal = specific ?? (parts.length > 0 || kind === 'formal' ? full : '');
  if (literal.length < 3 || (kind === 'core' && stemCanon.includes(literal))) return null;
  return escapeRegex(literal);
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

// 模型按 canon 形式写片段，而 canon 不是幂等的：x_(n+1) 再过一遍变成 x_(()n+1)，这个片段就再也拦不住任何东西。
// 所以只对还带 LaTeX 的片段做 canon。
export function fragmentCanon(fragment: string): string {
  return /[\\$]|[_^]\{/.test(fragment) ? canon(fragment) : fragment.replace(/\s+/g, '');
}

// 片段如果本来就出现在题面、词条或所选概念卡里，就不可能是“泄题”，留着只会误拦这些文本。
export function publicTextCanon(stem: string, concepts: ConceptsFile, conceptIds: readonly string[]): string[] {
  const texts = [canon(stem), ...(concepts.glossary ?? []).map((term) => canon(term.answer))];
  for (const concept of concepts.concepts as Array<{ id: string; card?: unknown; lesson?: unknown }>) {
    if (conceptIds.includes(concept.id)) texts.push(...collectStrings({ card: concept.card, lesson: concept.lesson }).map((text) => canon(text)));
  }
  return texts;
}

const HINT_PREFIX = /^\s*(?:H[0-4]|提示\s*[0-4]?)\s*[:：.．、]\s*/;
const HANDS_BACK = /下一行|下一步|由你|你来|接着写|交给你|自己写/;

// H2 只指方向：带可照抄式子或片段的句子去掉；全去掉了就只点明这一步要做什么。
function cleanH2(text: string, label: string, fragments: readonly string[], stemCanon: string, exampleCanon: readonly string[]): string {
  const copyable = (chunk: string): boolean => {
    const chunkCanon = canon(chunk);
    return copyableFragments(chunk, stemCanon, exampleCanon).length > 0 || fragments.some((fragment) => chunkCanon.includes(fragment));
  };
  if (!copyable(text)) return text;
  const kept = text
    .split(/(?<=[。！？；?!;])/)
    .filter((sentence) => !copyable(sentence))
    .join('')
    .trim();
  if (kept.length >= 8) return kept;
  return copyable(label) ? '回到上一步得到的结论，想一想接下来该用哪个定义或定理。' : `这一步要做的是“${label}”。想一想该用哪个定义或定理。`;
}

export interface AssembleContext {
  part: VerifiedPart;
  item: SegmentedItem;
  problemId: string;
  concepts: ConceptsFile;
  batchId: string;
  model: string;
  verifierModel: string;
  bookTitles?: Record<string, string>;
}

const LAYERS_OFF = { enabled: false };

export function assemblePackage(draft: RawDraft, context: AssembleContext): ProblemPackage {
  const { part, item, problemId, concepts } = context;
  const stem = part.statement;
  const stemCanon = canon(stem);
  const knownConcepts = new Set((concepts.concepts as Array<{ id: string }>).map((concept) => concept.id));
  const conceptIds = asStrings(draft.concepts).filter((id) => knownConcepts.has(id));
  const publicTexts = publicTextCanon(stem, concepts, conceptIds);
  const proofLines = asStrings(draft.referenceProof).map((line) => line.trim()).filter((line) => line !== '');
  const proofText = proofLines.join('\n');
  const proofCanonLines = proofLines.map((line) => canon(line));
  const rawKeys = Array.isArray(draft.keys) ? (draft.keys as Array<Record<string, unknown>>) : [];
  const hintsByKey = rawKeys.map((raw) =>
    Array.isArray(raw.hints)
      ? (raw.hints as unknown[]).map((hint) =>
          (typeof hint === 'string' ? hint : typeof (hint as { text?: unknown })?.text === 'string' ? ((hint as { text: string }).text) : '').replace(HINT_PREFIX, ''),
        )
      : [],
  );
  // 第一遍：模式、样例、片段。
  const drafted = rawKeys.map((raw, index) => {
    const hintTexts = hintsByKey[index] ?? [];
    const usable = [...new Set(asStrings(raw.patterns).map(fixPattern))].filter(usablePattern);
    const stemSafe = usable.filter((pattern) => !new RegExp(pattern, 'u').test(stemCanon));
    // core 步骤的模式命中题面等于抄题就得分：能去掉就去掉；全都命中，说明这一步只是复述结论，按 formal 算。
    const kind = raw.kind === 'formal' || (usable.length > 0 && stemSafe.length === 0) ? ('formal' as const) : ('core' as const);
    const patterns = kind === 'formal' ? usable : stemSafe;

    // 样例、或模型说“这一步写在第 n 行”的那行没被命中时，补字面模式。
    const ownLine = typeof raw.proofLine === 'number' ? proofLines[raw.proofLine - 1] : undefined;
    if (ownLine !== undefined && !matchesAnyPattern(patterns, canon(ownLine))) {
      const literal = literalPatternFor(ownLine, kind, stemCanon);
      if (literal !== null) patterns.push(literal);
    }
    const examples: string[] = [];
    for (const example of asStrings(raw.examples)) {
      if (matchesAnyPattern(patterns, canon(example))) {
        examples.push(example);
        continue;
      }
      const literal = literalPatternFor(example, kind, stemCanon);
      if (literal !== null) {
        patterns.push(literal);
        examples.push(example);
      }
    }
    // 样例不够两条时，用命中这一步的证明行补，再用 H4 示范的第一句补。
    const handShown = (hintTexts[4] ?? '').split(/(?<=[。！？；])/)[0] ?? '';
    for (const line of [ownLine, ...proofLines, handShown]) {
      if (examples.length >= 2) break;
      if (line !== undefined && line !== '' && !examples.includes(line) && matchesAnyPattern(patterns, canon(line))) examples.push(line);
    }
    // 模式不到两条时，用样例和证明行补一条字面的。
    for (const line of [ownLine, ...examples]) {
      if (patterns.length >= 2 || line === undefined) continue;
      const options = [literalPatternFor(line, kind, stemCanon), escapeRegex(canon(line))];
      const extra = options.find((option): option is string => option !== null && option.length >= 3 && !patterns.includes(option) && !(kind === 'core' && new RegExp(option, 'u').test(stemCanon)));
      if (extra !== undefined) patterns.push(extra);
    }

    let leak = [
      ...new Set(
        asStrings(raw.leak)
          .map((fragment) => fragmentCanon(fragment))
          .filter((fragment) => fragment.length >= 3 && fragment.length <= 120 && !publicTexts.some((text) => text.includes(fragment))),
      ),
    ];
    const written = [...proofCanonLines, ...examples.map((example) => canon(example))];
    const isReal = (fragment: string): boolean => written.some((text) => text.includes(fragment));
    // 本步 H0、H1 和前面步骤的提示本来就写出来给学生看了：同时还有别的真片段时，撞上的片段不算秘密。
    const shown = [...hintTexts.slice(0, 2), ...hintsByKey.slice(0, index).flatMap((hints) => hints.filter((_, level) => level !== 2))].map((text) => canon(text));
    const unseen = leak.filter((fragment) => !shown.some((text) => text.includes(fragment)));
    if (unseen.some(isReal)) leak = unseen;
    // 片段得是真会写出来的东西。全都对不上时：formal 步骤清空；core 步骤从样例里取最具体的式子。
    if (!leak.some(isReal)) {
      leak = [];
      if (kind === 'core') {
        const avoid = [...shown, canon(hintTexts[2] ?? '')];
        const derived = examples
          .flatMap((example) => mathPartsOf(example))
          .filter((text) => text.length >= 5 && text.length <= 120)
          .filter((text) => !publicTexts.some((publicText) => publicText.includes(text)) && !avoid.some((hint) => hint.includes(text)))
          .sort((a, b) => b.length - a.length)[0];
        if (derived !== undefined) leak.push(derived);
      }
    }
    return { kind, patterns, examples, leak };
  });

  // 第二遍：提示。H2 里能照抄的句子去掉，H4 要把下一行交还学生。
  const keys = rawKeys.map((raw, index) => {
    const id = `K${index + 1}`;
    const { kind, patterns, examples, leak } = drafted[index] as (typeof drafted)[number];
    const label = typeof raw.label === 'string' ? raw.label : id;
    const hintTexts = hintsByKey[index] ?? [];
    const levels = ['H0', 'H1', 'H2', 'H3', 'H4'] as const;
    const costs = [0, 0, 0.5, 1, 1] as const;
    const notYetAllowed = drafted.slice(index).flatMap((key) => key.leak);
    const textOf = (position: number): string => {
      const text = hintTexts[position] ?? '';
      if (position === 2) return cleanH2(text, label, notYetAllowed, stemCanon, examples.map((example) => canon(example)));
      if (position === 4 && !HANDS_BACK.test(text)) return `${text.trim()}下一行由你写。`;
      return text;
    };
    return {
      id,
      kind,
      label,
      deps: asStrings(raw.deps).filter((dep) => /^K\d+$/.test(dep) && Number(dep.slice(1)) <= rawKeys.length && dep !== id),
      patterns,
      examples,
      leak,
      ...(typeof raw.jev === 'string' ? { jev: raw.jev } : {}),
      hints: levels.map((level, position) => ({
        level,
        text: textOf(position),
        cost: costs[position] as 0 | 0.5 | 1,
        ...(level === 'H4' ? { handsBack: true } : {}),
      })),
    };
  });

  const allLeak = keys.flatMap((key) => key.leak);
  const leaksSomething = (text: string): boolean => {
    const textCanon = canon(text);
    return allLeak.some((fragment) => textCanon.includes(fragment));
  };

  const exampleCanon = keys.flatMap((key) => key.examples.map((example) => canon(example)));

  // 错误类型优先于关键步骤：能截走样例或参考证明的错误模式一定是写宽了，直接丢弃，不值得为它重试。
  const rawErrors = Array.isArray(draft.errors) ? (draft.errors as Array<Record<string, unknown>>) : [];
  const errors = rawErrors.flatMap((raw, index) => {
    const patterns = asStrings(raw.patterns).map(fixPattern).filter(usablePattern);
    const question = typeof raw.question === 'string' ? raw.question : '';
    // 错误追问、总结问题是可选内容：带了片段就丢掉这一条，不值得为它重试。
    if (patterns.length === 0 || question === '' || leaksSomething(question)) return [];
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'u');
        if ([...exampleCanon, ...proofCanonLines].some((text) => regex.test(text))) return [];
      } catch {
        return [];
      }
    }
    return [
      {
        id: `E${index + 1}`,
        label: typeof raw.label === 'string' ? raw.label : `常见错误 ${index + 1}`,
        patterns,
        question,
      },
    ];
  });

  const rawSummary = Array.isArray(draft.summaryPoints) ? (draft.summaryPoints as Array<Record<string, unknown>>) : [];
  const summaryPoints = rawSummary.flatMap((raw, index) => {
    const patterns = asStrings(raw.patterns).map(fixPattern).filter(usablePattern);
    const question = typeof raw.question === 'string' ? raw.question : '';
    return patterns.length === 0 || question === '' || leaksSomething(question) ? [] : [{ id: `S${index + 1}`, patterns, question }];
  });

  const walkthrough = (draft.walkthrough ?? {}) as { approach?: unknown; keyIdeas?: unknown; pitfalls?: unknown };
  const pkg = {
    schemaVersion: '1.0',
    id: problemId,
    version: 1,
    kind: 'main',
    public: {
      title: typeof draft.title === 'string' ? draft.title.trim().slice(0, 60) : '',
      stem,
      source: {
        book: context.bookTitles?.[item.book] ?? item.book,
        volume: item.volume,
        chapter: item.chapterNo,
        ...(item.section === '' ? {} : { section: item.section }),
        itemType: item.itemType,
        itemNo: item.itemNo,
        pages: item.pages,
        ...(item.examSource === undefined ? {} : { examSource: item.examSource }),
      },
      chapter: item.chapter,
      tags: asStrings(draft.tags).slice(0, 12),
      difficulty: part.verdict.difficulty,
      role: 'optional',
      concepts: conceptIds,
      layers: {
        L1: LAYERS_OFF,
        L2: LAYERS_OFF,
        L3: { enabled: true, skippable: false, skipRule: 'none' },
        L4: LAYERS_OFF,
        L5: LAYERS_OFF,
        L6: { enabled: true, skippable: false, skipRule: 'none' },
      },
      selfcheckCount: 0,
      askChips: asStrings(draft.askChips).filter((chip) => !leaksSomething(chip)).map((chip) => chip.slice(0, 30)).slice(0, 6),
      keyCount: keys.length,
      budget: { reveal: 2, dwellSec: 20, rapidWindowSec: 30, rapidCount: 3, rapidLockSec: 60, stuckMs: 180000 },
    },
    secret: {
      keys,
      routes: [keys.map((key) => key.id)],
      errors,
      allowedTheorems: [],
      forbiddenTheorems: [],
      selfcheckBank: [],
      summaryPoints,
      referenceProofs: [{ id: 'P1', route: 0, text: proofText, publishable: true }],
      walkthrough: {
        approach: typeof walkthrough.approach === 'string' ? walkthrough.approach : '',
        keyIdeas: asStrings(walkthrough.keyIdeas).slice(0, 5),
        pitfalls: asStrings(walkthrough.pitfalls).slice(0, 4),
      },
    },
    review: { status: 'published', reviewer: 'ai-import' },
    provenance: {
      importJobId: context.batchId,
      draftedBy: [context.model],
      arbiter: context.verifierModel,
      promptVersion: PROMPT_VERSION,
    },
  };
  return pkg as unknown as ProblemPackage;
}

// 把重试的补丁合进上一稿。keys 按 id 合并；模型如果还是给了整份，效果也一样。
export function mergeDraft(base: RawDraft, patch: RawDraft): RawDraft {
  const { keys: patchKeys, ...others } = patch;
  const merged: RawDraft = { ...base, ...others };
  if (Array.isArray(patchKeys)) {
    const keys = [...((base.keys as Array<Record<string, unknown>> | undefined) ?? [])];
    (patchKeys as Array<Record<string, unknown>>).forEach((keyPatch, position) => {
      const index = typeof keyPatch.id === 'string' ? keys.findIndex((key) => key.id === keyPatch.id) : patchKeys.length === keys.length ? position : -1;
      if (index === -1) keys.push(keyPatch);
      else keys[index] = { ...keys[index], ...keyPatch };
    });
    merged.keys = keys;
  }
  return merged;
}

function withKeyIds(draft: RawDraft): RawDraft {
  if (!Array.isArray(draft.keys)) return draft;
  return { ...draft, keys: (draft.keys as Array<Record<string, unknown>>).map((key, index) => ({ ...key, id: `K${index + 1}` })) };
}

// 题面原样来自校验过的文本；参考证明要能追溯到已核验的证明，防止模型改写出一份没校验过的证明。
export function proofFidelityIssues(pkg: ProblemPackage, verifiedSolution: string): CheckIssue[] {
  const source = canon(verifiedSolution);
  const formulas = splitMath(pkg.secret.referenceProofs[0]?.text ?? '')
    .filter((part) => part.math)
    .map((part) => canon(`$${part.s}$`))
    .filter((formula) => formula.length >= 6);
  if (formulas.length === 0) return [];
  const found = formulas.filter((formula) => source.includes(formula)).length;
  const ratio = found / formulas.length;
  return ratio < 0.4
    ? [{ where: 'referenceProofs.P1', message: `参考证明与已核验的证明差别太大（只有 ${Math.round(ratio * 100)}% 的式子能对上）：请只拆行、规范表述，不要换写法` }]
    : [];
}

function feedbackFor(pkg: ProblemPackage, gates: ImportGateResult, extra: CheckIssue[]): string {
  const issues = [...extra, ...gates.issues].slice(0, 25).map((issue) => `- ${issue.where}：${issue.message}`);
  const lines = gates.replay.lines.map((line) => `第${line.n}行 canon=${line.canon}  命中=${line.keys.join(',') || (line.cls === 'error' ? `错误${line.errorId}` : '无')}`);
  const patterns = pkg.secret.keys.map((key) => `${key.id} patterns=${JSON.stringify(key.patterns)}`);
  return [
    '上面的 JSON 没有通过校验，问题如下：',
    ...issues,
    '',
    '当前参考证明逐行的 canon 结果与命中情况（模式要对着 canon 结果写）：',
    ...lines,
    '',
    '当前模式：',
    ...patterns,
    '',
    '修好以上问题。只输出需要改动的部分，没问题的内容不要重复：顶层字段只写改动的字段；keys 只写要改的步骤，每个写 id 和改动的字段，如 {"keys":[{"id":"K2","patterns":["..."],"proofLine":3}],"referenceProof":["..."]}；hints 要改就写全 5 条。只输出 JSON。',
  ].join('\n');
}

export interface DraftOutcome {
  promptVersion: string;
  draftModel?: string;
  partId: string;
  problemId: string;
  ok: boolean;
  attempts: number;
  cost: number;
  reason?: string;
  issues: CheckIssue[];
  pkg?: ProblemPackage;
  quality?: number;
  band?: string;
  replay?: { lines: number; matched: string[] };
}

// 质量分：校验置信度、步骤数是否合适、模式覆盖、起草是否一次通过。分低的排到单元末尾。
export function qualityScore(pkg: ProblemPackage, part: VerifiedPart, attempts: number): number {
  const keys = pkg.secret.keys;
  const keyScore = keys.length >= 3 && keys.length <= 5 ? 1 : 0.6;
  const patternScore = Math.min(1, keys.reduce((sum, key) => sum + key.patterns.length, 0) / (keys.length * 3));
  const attemptScore = attempts === 1 ? 1 : attempts === 2 ? 0.8 : 0.6;
  const repairedPenalty = part.repaired ? 0.85 : 1;
  const score = (0.5 * part.verdict.confidence + 0.2 * keyScore + 0.15 * patternScore + 0.15 * attemptScore) * repairedPenalty;
  return Number(score.toFixed(3));
}

export function drafterOf(outcome: DraftOutcome): string {
  const drafted = (outcome.pkg?.provenance as { draftedBy?: string[] } | undefined)?.draftedBy?.[0];
  return outcome.draftModel ?? drafted ?? LEGACY_DRAFTER;
}

export function problemIdFor(partId: string): string {
  const slug = `imp-${partId}`.replace(/[^A-Za-z0-9_-]/g, '-');
  if (slug.length <= 64) return slug;
  return `${slug.slice(0, 55)}-${createHash('sha256').update(slug).digest('hex').slice(0, 8)}`;
}

export interface DraftOptions {
  outDir: string;
  client: ChatClient;
  concepts: ConceptsFile;
  batchId: string;
  model?: string;
  verifierModel: string;
  bookTitles?: Record<string, string>;
}

export async function draftPart(part: VerifiedPart, item: SegmentedItem, options: DraftOptions): Promise<DraftOutcome> {
  const dir = join(options.outDir, 'drafts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${part.partId}.json`);
  // 缓存只认当前提示词版本：提示词改了，旧结果（尤其是失败）值得重来。
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as DraftOutcome;
    if (cached.promptVersion === PROMPT_VERSION) return cached;
  }

  const model = options.model ?? DRAFT_MODEL;
  const problemId = problemIdFor(part.partId);
  const context: AssembleContext = {
    part,
    item,
    problemId,
    concepts: options.concepts,
    batchId: options.batchId,
    model,
    verifierModel: options.verifierModel,
    ...(options.bookTitles === undefined ? {} : { bookTitles: options.bookTitles }),
  };
  const messages: ChatMessage[] = [
    { role: 'system', content: draftSystemPrompt(options.concepts) },
    {
      role: 'user',
      content: [
        `【章节】${item.chapter} ${item.section}`,
        `【题面】${part.statement}`,
        `【题面的 canon】${canon(part.statement)}`,
        `【已核验的证明】\n${part.solution}`,
        `【已核验证明每一行的 canon】\n${splitProofLines(part.solution).map((line) => canon(line)).join('\n')}`,
        `【难度】${part.verdict.difficulty}/5`,
      ].join('\n'),
    },
  ];

  let cost = 0;
  let current: RawDraft | undefined;
  let lastIssues: CheckIssue[] = [];
  let reason = 'no_attempt';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await options.client.chat({
      stage: attempt === 1 ? 'draft' : 'draft-repair',
      ref: part.partId,
      provider: providerOf(model),
      model,
      temperature: attempt === 1 ? 0.3 : 0.2,
      json: true,
      maxTokens: 12000,
      messages,
    });
    cost += response.cost;
    messages.push({ role: 'assistant', content: response.text });
    let raw: RawDraft;
    try {
      raw = parseJsonLoose<RawDraft>(response.text);
    } catch {
      lastIssues = [{ where: 'json', message: '输出不是合法 JSON' }];
      reason = response.finishReason === 'length' ? 'truncated' : 'bad_json';
      messages.push({ role: 'user', content: '上面的输出不是合法 JSON。请只输出一个 JSON 对象，字符串里的反斜杠要写成双反斜杠。' });
      continue;
    }
    current = current === undefined ? withKeyIds(raw) : mergeDraft(current, raw);
    const pkg = assemblePackage(current, context);
    const gates = runImportGates(pkg, options.concepts);
    const fidelity = proofFidelityIssues(pkg, part.solution);
    if (gates.ok && fidelity.length === 0) {
      const outcome: DraftOutcome = {
        promptVersion: PROMPT_VERSION,
        draftModel: model,
        partId: part.partId,
        problemId,
        ok: true,
        attempts: attempt,
        cost,
        issues: [],
        pkg,
        quality: qualityScore(pkg, part, attempt),
        band: bandOf(part.verdict.difficulty),
        replay: { lines: gates.replay.lines.length, matched: gates.replay.matched },
      };
      writeAtomic(file, `${JSON.stringify(outcome)}\n`);
      return outcome;
    }
    lastIssues = [...fidelity, ...gates.issues];
    reason = categorize(lastIssues);
    messages.push({ role: 'user', content: feedbackFor(pkg, gates, fidelity) });
  }
  const failed: DraftOutcome = {
    promptVersion: PROMPT_VERSION,
    draftModel: model,
    partId: part.partId,
    problemId,
    ok: false,
    attempts: MAX_ATTEMPTS,
    cost,
    reason,
    issues: lastIssues.slice(0, 30),
  };
  writeAtomic(file, `${JSON.stringify(failed)}\n`);
  return failed;
}

// 失败报告用的归类：一题多个问题时取最靠前（最致命）的一类。
export function categorize(issues: readonly CheckIssue[]): string {
  const order: Array<[RegExp, string]> = [
    [/JSON Schema/, 'schema'],
    [/replay|参考证明/, 'replay'],
    [/KaTeX/, 'katex'],
    [/泄题|片段/, 'leak'],
    [/样例|模式|正则/, 'patterns'],
    [/提示|透露|H[0-4]/, 'hints'],
  ];
  for (const [regex, label] of order) {
    if (issues.some((issue) => regex.test(`${issue.where} ${issue.message}`))) return label;
  }
  return 'other';
}
