import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ProblemPackage } from '@proof-gym/engine';
import { describe, expect, it } from 'vitest';

import { stageDraft, type Queryable } from '../src/db.ts';

function seed(): ProblemPackage {
  const path = fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json'));
  return JSON.parse(readFileSync(path, 'utf8')) as ProblemPackage;
}

interface Recorded {
  sql: string;
  params: unknown[];
}

function fakeDb(maxVersion: number): { db: Queryable; queries: Recorded[] } {
  const queries: Recorded[] = [];
  const db: Queryable = {
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      queries.push({ sql, params });
      if (sql.includes('select max(version)')) return { rows: [{ max: maxVersion }] as T[] };
      return { rows: [] };
    },
  };
  return { db, queries };
}

describe('导入草稿暂存（#42 / import:submit）', () => {
  it('版本冲突顺延 max+1，写 draft + auto_checks + vault secret（去掉 referenceProofs）', async () => {
    const { db, queries } = fakeDb(1);
    const pkg = seed();
    const staged = await stageDraft(pkg, db);
    expect(staged).toMatchObject({ problemId: 'epsN', version: 2, issues: 0 });
    expect(staged.autoChecks).toEqual({ schema: true, katex: true, leakExhaustive: true, patternSelfTest: true });

    const versionInsert = queries.find((q) => q.sql.includes('insert into content.problem_versions'));
    expect(versionInsert?.params[1]).toBe(2);
    expect(String(versionInsert?.params[2])).toContain('数列极限');
    expect(versionInsert?.params[3]).toBe(JSON.stringify(staged.autoChecks));

    const secretInsert = queries.find((q) => q.sql.includes('insert into vault.problem_secrets'));
    const secret = JSON.parse(String(secretInsert?.params[2])) as Record<string, unknown>;
    expect(secret).not.toHaveProperty('referenceProofs');
    expect(Array.isArray(secret.keys)).toBe(true);

    const proofInserts = queries.filter((q) => q.sql.includes('insert into vault.reference_proofs'));
    const proofs = (pkg.secret as { referenceProofs?: unknown[] }).referenceProofs ?? [];
    expect(proofInserts).toHaveLength(proofs.length);
  });

  it('包自带版本高于当前最大版本时沿用该版本', async () => {
    const { db } = fakeDb(1);
    const pkg = seed();
    pkg.version = 5;
    const staged = await stageDraft(pkg, db);
    expect(staged.version).toBe(5);
  });

  it('S8 失败时仍可暂存（auto_checks 记录失败项，供审核屏退回）', async () => {
    const { db } = fakeDb(1);
    const pkg = seed();
    pkg.public.keyCount = pkg.public.keyCount + 1; // 结构检查失败
    const staged = await stageDraft(pkg, db);
    expect(staged.issues).toBeGreaterThan(0);
    expect(staged.autoChecks.patternSelfTest).toBe(false);
  });
});
