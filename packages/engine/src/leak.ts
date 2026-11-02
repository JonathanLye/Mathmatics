import { canon } from './canon.ts';
import { gateRule, hintAllow } from './gate.ts';
import type { ProblemPackage } from './types.ts';

// 穷举泄题检查（10-开发文档/contracts/tools/check-seeds.mjs 第 108–142 行的引擎侧复跑）。
// 与 check-seeds 的区别：这里直接调用运行时的 gateRule，不另写一份匹配逻辑。
export interface ConceptsFile {
  concepts: { id: string; card?: unknown; lesson?: unknown }[];
  glossary: { id: string; answer: string }[];
}

export interface LeakFailure {
  where: string;
  message: string;
}

// 与 contracts/tools/check-seeds.mjs 的 walkStrings 跳过的字段名一致（它们是模式、片段或标识，不是学生可见文本）。
// 两处是手抄的：改动时必须同步，见 contracts/tools/check-seeds.mjs 第 60 行。
const SKIP_FIELDS = new Set(['patterns', 'leak', 'triggers', 'expr', 'jev', 'label', 'code', 'map', 'file', 'id']);

function walkStrings(value: unknown, where: string, visit: (where: string, text: string) => void): void {
  if (typeof value === 'string') return visit(where, value);
  if (Array.isArray(value)) return value.forEach((x, i) => walkStrings(x, `${where}[${i}]`, visit));
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (!SKIP_FIELDS.has(k)) walkStrings(v, `${where}.${k}`, visit);
    }
  }
}

export function leakExhaustive(pkg: ProblemPackage, concepts: ConceptsFile): LeakFailure[] {
  const P = pkg.public;
  const S = pkg.secret;
  const failures: LeakFailure[] = [];

  const stem = canon(P.stem);
  for (const key of S.keys) {
    for (const frag of key.leak) {
      if (stem.includes(canon(frag))) {
        failures.push({ where: `${key.id}.leak`, message: `片段 "${frag}" 是题面的一部分，不能作为泄题片段` });
      }
    }
  }

  const check = (where: string, text: string, matched: ReadonlySet<string> = new Set(), allow: readonly string[] = []) => {
    const result = gateRule(S, text, matched, allow);
    if (!result.ok) {
      failures.push({ where, message: `泄题片段 ${JSON.stringify(result.hits.map((h) => h.frag))} 出现在：${text}` });
    }
  };

  // (a) 第 3 层之前或随时可能出现的文本：一个关键步骤都没写出
  if (P.def) check('public.def.task', P.def.task);
  if (P.frame) {
    check('public.frame.task', P.frame.task);
    check('public.frame.template', P.frame.template);
  }
  (P.askChips ?? []).forEach((t, i) => check(`askChips[${i}]`, t));
  (S.def?.components ?? []).forEach((c) => check(`def.${c.id}.missing`, c.missing));
  if (S.def?.orderQuestion) check('def.orderQuestion', S.def.orderQuestion);
  (S.frame?.checks ?? []).forEach((c) => check(`frame.${c.id}.missing`, c.missing));
  S.errors.forEach((e) => check(`errors.${e.id}.question`, e.question));

  const conceptIds = new Set(
    [...(P.concepts ?? []), P.def?.conceptId, P.frame?.lessonId].filter((x): x is string => Boolean(x)),
  );
  for (const con of concepts.concepts.filter((c) => conceptIds.has(c.id))) {
    walkStrings({ card: con.card, lesson: con.lesson }, `concept:${con.id}`, check);
  }
  for (const g of concepts.glossary) check(`glossary.${g.id}`, g.answer);

  // (b) 提示：按路线顺序，前面的关键步骤视为已写出；只有透露量为 1 的提示可以出现本步骤的片段
  for (const route of S.routes) {
    route.forEach((id, i) => {
      const key = S.keys.find((k) => k.id === id);
      if (!key) throw new Error(`路线引用了不存在的关键步骤 ${id}`);
      const matched = new Set(route.slice(0, i));
      for (const h of key.hints) check(`${id}.${h.level}`, h.text, matched, hintAllow(id, h.cost));
    });
  }

  // (c) 自检、总结：路线全部写出后，只要求不出现路线外步骤的片段
  for (const route of S.routes) {
    const all = new Set(route);
    for (const q of S.selfcheckBank) check(`selfcheck.${q.id}`, q.template, all);
    for (const q of S.summaryPoints) check(`summary.${q.id}`, q.question, all);
  }

  return failures;
}
