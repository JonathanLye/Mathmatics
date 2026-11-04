import type { ProblemPackage } from '@proof-gym/engine';

import { checkCategories, type CheckCategories, type CheckOptions } from './checks.ts';

// 与 pg Client 兼容的最小接口；测试可注入 fake，避免依赖真实 DB。
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface StagedDraft {
  problemId: string;
  version: number;
  autoChecks: CheckCategories;
  issues: number;
}

interface ReferenceProof {
  id: string;
  route?: number;
  text: string;
  publishable?: boolean;
}

// #42 S9 前一步：把 CLI 草稿写入 content.problem_versions(review_status='draft') + vault secrets，
// 让教师审核屏（#120/#128）能看到并 approve/return；approve 后由服务端切 current_version。
// 版本规则：包自带 version 若大于当前最大版本则沿用；否则顺延 max+1（已发布版本不可覆盖）。
export async function stageDraft(
  pkg: ProblemPackage,
  db: Queryable,
  options: CheckOptions = {},
): Promise<StagedDraft> {
  const checks = checkCategories(pkg, options);
  const maxRow = await db.query<{ max: number | null }>(
    `select max(version) as max from content.problem_versions where problem_id = $1`,
    [pkg.id],
  );
  const max = Number(maxRow.rows[0]?.max ?? 0);
  const version = pkg.version > max ? pkg.version : max + 1;

  await db.query(
    `insert into content.problems (id, kind, title, chapter)
     values ($1, $2, $3, $4)
     on conflict (id) do update set kind = excluded.kind, title = excluded.title, chapter = excluded.chapter`,
    [pkg.id, pkg.kind ?? 'main', pkg.public.title ?? pkg.id, pkg.public.chapter ?? null],
  );

  await db.query(
    `insert into content.problem_versions (problem_id, version, public, review_status, auto_checks, provenance)
     values ($1, $2, $3::jsonb, 'draft', $4::jsonb, $5::jsonb)`,
    [
      pkg.id,
      version,
      JSON.stringify(pkg.public),
      JSON.stringify(checks.categories),
      JSON.stringify({ source: 'import-cli', importedAt: new Date().toISOString() }),
    ],
  );

  const secret: Record<string, unknown> = { ...pkg.secret };
  const proofs = Array.isArray(secret.referenceProofs) ? (secret.referenceProofs as ReferenceProof[]) : [];
  delete secret.referenceProofs;
  await db.query(
    `insert into vault.problem_secrets (problem_id, version, secret) values ($1, $2, $3::jsonb)`,
    [pkg.id, version, JSON.stringify(secret)],
  );
  for (const proof of proofs) {
    await db.query(
      `insert into vault.reference_proofs (problem_id, version, proof_id, route, text, publishable)
       values ($1, $2, $3, $4, $5, $6)`,
      [pkg.id, version, proof.id, proof.route ?? null, proof.text, proof.publishable ?? true],
    );
  }

  return {
    problemId: pkg.id,
    version,
    autoChecks: checks.categories,
    issues: checks.issues.length,
  };
}
