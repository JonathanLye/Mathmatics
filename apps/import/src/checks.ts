import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import katex from 'katex';
import { leakExhaustive, type ProblemPackage } from '@proof-gym/engine';

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
export function checkPackage(pkg: ProblemPackage): CheckResult {
  const issues: CheckIssue[] = [...schemaValidate(pkg)];

  walkStrings(pkg, 'package', (where, text) => {
    for (const match of text.matchAll(MATH)) {
      try {
        katex.renderToString(match[1], { throwOnError: true, strict: 'ignore' });
      } catch {
        issues.push({ where, message: `KaTeX 渲染失败：${match[1]}` });
      }
    }
  });

  for (const failure of leakExhaustive(pkg, { concepts: [], glossary: [] })) {
    issues.push({ where: failure.where, message: failure.message });
  }

  return { ok: issues.length === 0, issues };
}
