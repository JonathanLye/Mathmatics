import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import katex from 'katex';
import { canon, leakExhaustive, type ConceptsFile, type ProblemPackage } from '@proof-gym/engine';

const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => Ajv2020;

export interface CheckIssue {
  where: string;
  message: string;
}

export interface CheckResult {
  ok: boolean;
  issues: CheckIssue[];
}

// 与 engine/leak 的 walkStrings 跳过字段一致（模式/片段/标识不是学生可见文本）。
const SKIP_FIELDS = new Set(['patterns', 'leak', 'triggers', 'expr', 'jev', 'label', 'code', 'map', 'file', 'id']);
const MATH = /\$([^$\n]+)\$/g;

function walkStrings(value: unknown, where: string, visit: (where: string, text: string) => void): void {
  if (typeof value === 'string') return visit(where, value);
  if (Array.isArray(value)) return value.forEach((item, index) => walkStrings(item, `${where}[${index}]`, visit));
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!SKIP_FIELDS.has(key)) walkStrings(item, `${where}.${key}`, visit);
    }
  }
}

let cachedValidate: ((data: unknown) => boolean) | null = null;
let cachedErrors: unknown[] = [];

function schemaValidate(pkg: ProblemPackage): CheckIssue[] {
  if (cachedValidate === null) {
    const schemaPath = fileURLToPath(import.meta.resolve('@proof-gym/contracts/problem-package.schema.json'));
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object;
    const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
    addFormats(ajv);
    const compiled = ajv.compile(schema);
    cachedValidate = (data: unknown) => {
      const ok = compiled(data);
      cachedErrors = compiled.errors ?? [];
      return ok;
    };
  }
  const validate = cachedValidate;
  const ok = validate(pkg);
  return ok
    ? []
    : cachedErrors.map((error) => {
        const item = error as { instancePath?: string; message?: string };
        return { where: item.instancePath ?? 'package', message: `JSON Schema：${item.message ?? '不合法'}` };
      });
}

// 10 §2 S8 的 CLI 版自动校验：JSON Schema、KaTeX、穷举泄题。透露量校准由 report.ts 对两稿做比对提示。
// 与 contracts/tools/check-seeds.mjs 的穷举泄题同一实现（engine/leak 复跑 gateRule）。
export interface CheckOptions {
  // 与 check-seeds 对齐：概念卡/词条也要做穷举泄题检查（发布时传 seed/concepts.json）。
  concepts?: ConceptsFile;
}

// 结构与提示阶梯：与 contracts/tools/check-seeds.mjs 的规则一致（S8 同一口径，见 10 §2）。
function structuralIssues(pkg: ProblemPackage): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const P = pkg.public as ProblemPackage['public'] & {
    layers?: Record<string, { enabled?: boolean }>;
  };
  const S = pkg.secret;
  if (P.layers?.L1?.enabled === true && (P.def === undefined || S.def === undefined)) {
    issues.push({ where: 'public.def', message: 'L1 启用但缺 def' });
  }
  if (P.layers?.L2?.enabled === true && (P.frame === undefined || S.frame === undefined)) {
    issues.push({ where: 'public.frame', message: 'L2 启用但缺 frame' });
  }
  if (P.keyCount !== S.keys.length) {
    issues.push({ where: 'public.keyCount', message: `keyCount=${P.keyCount} 与 keys.length=${S.keys.length} 不一致` });
  }
  const keyIds = new Set(S.keys.map((key) => key.id));
  for (const route of S.routes) {
    for (const id of route) if (!keyIds.has(id)) issues.push({ where: 'secret.routes', message: `路线引用了不存在的 ${id}` });
  }
  for (const key of S.keys) {
    const levels = key.hints.map((hint) => hint.level).join(',');
    if (levels !== 'H0,H1,H2,H3,H4') issues.push({ where: `${key.id}.hints`, message: `提示级别应为 H0..H4，实际 ${levels}` });
    const costs = key.hints.map((hint) => hint.cost).join(',');
    if (costs !== '0,0,0.5,1,1') issues.push({ where: `${key.id}.hints`, message: `透露量应为 0,0,0.5,1,1，实际 ${costs}` });
    const compiled: RegExp[] = [];
    for (const pattern of key.patterns) {
      try {
        compiled.push(new RegExp(pattern, 'u'));
      } catch (error) {
        issues.push({ where: `${key.id}.patterns`, message: `正则不合法：${(error as Error).message}` });
      }
    }
    const compiledErrors = S.errors.map((error) => ({
      id: error.id,
      patterns: error.patterns.flatMap((pattern) => {
        try {
          return [new RegExp(pattern, 'u')];
        } catch {
          return [];
        }
      }),
    }));
    for (const example of key.examples ?? []) {
      const text = canon(example);
      if (!compiled.some((pattern) => pattern.test(text))) {
        issues.push({ where: `${key.id}.examples`, message: `样例未命中本步骤：${example}` });
      }
      const errorHit = compiledErrors.find((error) => error.patterns.some((pattern) => pattern.test(text)));
      if (errorHit) issues.push({ where: `${key.id}.examples`, message: `样例被错误类型 ${errorHit.id} 截走：${example}` });
    }
  }
  return issues;
}

export interface CheckCategories {
  schema: boolean;
  katex: boolean;
  leakExhaustive: boolean;
  patternSelfTest: boolean;
}

function katexIssues(pkg: ProblemPackage): CheckIssue[] {
  const issues: CheckIssue[] = [];
  walkStrings(pkg, 'package', (where, text) => {
    for (const match of text.matchAll(MATH)) {
      try {
        katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' });
      } catch {
        issues.push({ where, message: `KaTeX 渲染失败：${match[1]}` });
      }
    }
  });
  return issues;
}

// 给导入暂存/审核屏用的分项结果（S8 四项：schema / katex / leakExhaustive / patternSelfTest）。
export function checkCategories(
  pkg: ProblemPackage,
  options: CheckOptions = {},
): CheckResult & { categories: CheckCategories } {
  const schema = schemaValidate(pkg);
  if (schema.length > 0) {
    return { ok: false, issues: schema, categories: { schema: false, katex: false, leakExhaustive: false, patternSelfTest: false } };
  }
  if (pkg === null || typeof pkg !== 'object' || pkg.public === undefined || pkg.secret === undefined) {
    return {
      ok: false,
      issues: [{ where: 'package', message: '缺少 public/secret' }],
      categories: { schema: false, katex: false, leakExhaustive: false, patternSelfTest: false },
    };
  }
  const structural = structuralIssues(pkg);
  const katex = katexIssues(pkg);
  const leak =
    structural.length === 0
      ? leakExhaustive(pkg, options.concepts ?? { concepts: [], glossary: [] }).map((failure) => ({
          where: failure.where,
          message: failure.message,
        }))
      : [];
  const issues = [...structural, ...katex, ...leak];
  return {
    ok: issues.length === 0,
    issues,
    categories: {
      schema: true,
      katex: katex.length === 0,
      leakExhaustive: leak.length === 0,
      patternSelfTest: structural.length === 0,
    },
  };
}

export function checkPackage(pkg: ProblemPackage, options: CheckOptions = {}): CheckResult {
  const result = checkCategories(pkg, options);
  return { ok: result.ok, issues: result.issues };
}
