import { readFileSync } from 'node:fs';

import type { ProblemPackage } from '@proof-gym/engine';
import { Client } from 'pg';

import { checkPackage, type CheckIssue } from './checks.ts';

export interface PublishResult {
  ok: boolean;
  mode: 'dry-run' | 'db';
  issues: CheckIssue[];
}

interface ReferenceProof {
  id: string;
  route?: number;
  text: string;
  publishable?: boolean;
}

// 10 §6 / §2 S9：发布前再跑 S8；设 DATABASE_URL 时写库并记录审核人与用时，否则 dry-run。
export async function publishPackage(
  file: string,
  options: { reviewer: string; minutes: number; databaseUrl?: string },
): Promise<PublishResult> {
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as ProblemPackage;
  const checks = checkPackage(pkg);
  const mode = options.databaseUrl === undefined ? 'dry-run' : 'db';
  if (!checks.ok) return { ok: false, mode, issues: checks.issues };
  if (options.databaseUrl === undefined) return { ok: true, mode, issues: [] };

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const reviewer = await client.query<{ id: string }>(`select id from app.users where anon_code = $1`, [
      options.reviewer,
    ]);
    const reviewerId = reviewer.rows[0]?.id;
    if (reviewerId === undefined) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        mode,
        issues: [{ where: 'reviewer', message: `找不到匿名码 ${options.reviewer} 对应的用户（先用 db/cli.ts 创建）` }],
      };
    }

    await client.query(
      `insert into content.problems (id, kind, title, chapter, current_version)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set kind = excluded.kind, title = excluded.title,
         chapter = excluded.chapter, current_version = excluded.current_version`,
      [pkg.id, pkg.kind ?? 'main', pkg.public.title ?? pkg.id, pkg.public.chapter ?? null, pkg.version],
    );

    const provenance = (pkg as { provenance?: unknown }).provenance ?? {};
    await client.query(
      `insert into content.problem_versions
         (problem_id, version, public, review_status, auto_checks, provenance, reviewed_by, reviewed_at, published_at)
       values ($1, $2, $3::jsonb, 'published', '{}'::jsonb, $4::jsonb, $5, now(), now())
       on conflict (problem_id, version) do update set public = excluded.public, review_status = 'published',
         reviewed_by = excluded.reviewed_by, reviewed_at = now(), published_at = now()`,
      [pkg.id, pkg.version, JSON.stringify(pkg.public), JSON.stringify(provenance), reviewerId],
    );

    const secret: Record<string, unknown> = { ...pkg.secret };
    const proofs = Array.isArray(secret.referenceProofs) ? (secret.referenceProofs as ReferenceProof[]) : [];
    delete secret.referenceProofs;
    await client.query(
      `insert into vault.problem_secrets (problem_id, version, secret) values ($1, $2, $3::jsonb)
       on conflict (problem_id, version) do update set secret = excluded.secret`,
      [pkg.id, pkg.version, JSON.stringify(secret)],
    );
    for (const proof of proofs) {
      await client.query(
        `insert into vault.reference_proofs (problem_id, version, proof_id, route, text, publishable)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (problem_id, version, proof_id) do update set route = excluded.route,
           text = excluded.text, publishable = excluded.publishable`,
        [pkg.id, pkg.version, proof.id, proof.route ?? null, proof.text, proof.publishable ?? true],
      );
    }

    await client.query(
      `insert into content.review_records (problem_id, version, reviewer_id, decision, minutes_spent)
       values ($1, $2, $3, 'approve', $4)`,
      [pkg.id, pkg.version, reviewerId, options.minutes],
    );
    await client.query('COMMIT');
    return { ok: true, mode, issues: [] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
