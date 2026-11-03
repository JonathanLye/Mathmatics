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

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}

// 10 §6 / §2 S9：发布前再跑 S8；设 DATABASE_URL 时写库并记录审核人与用时，否则 dry-run。
// 同一 version 已发布：内容相同→幂等跳过；内容不同→要求 bump version（07 published 不可变）。
export async function publishPackage(
  file: string,
  options: { reviewer: string; minutes: number; databaseUrl?: string },
): Promise<PublishResult> {
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as ProblemPackage;
  const checks = checkPackage(pkg);
  const databaseUrl = options.databaseUrl?.trim();
  const mode: PublishResult['mode'] = databaseUrl === undefined || databaseUrl === '' ? 'dry-run' : 'db';
  if (!checks.ok) return { ok: false, mode, issues: checks.issues };
  if (mode === 'dry-run') return { ok: true, mode, issues: [] };

  const client = new Client({ connectionString: databaseUrl });
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

    const existing = await client.query<{ public: unknown }>(
      `select public from content.problem_versions where problem_id = $1 and version = $2`,
      [pkg.id, pkg.version],
    );
    const already = existing.rows[0];
    if (already !== undefined && stable(already.public) !== stable(pkg.public)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        mode,
        issues: [
          {
            where: 'version',
            message: `v${pkg.version} 已发布且 public 内容有变化；已发布不可变，请 bump version 后重新发布`,
          },
        ],
      };
    }

    await client.query(
      `insert into content.problems (id, kind, title, chapter, current_version)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set kind = excluded.kind, title = excluded.title,
         chapter = excluded.chapter,
         current_version = greatest(coalesce(content.problems.current_version, 0), excluded.current_version)`,
      [pkg.id, pkg.kind ?? 'main', pkg.public.title ?? pkg.id, pkg.public.chapter ?? null, pkg.version],
    );

    if (already === undefined) {
      const provenance = (pkg as { provenance?: unknown }).provenance ?? {};
      const autoChecks = { passed: true, checkedAt: new Date().toISOString(), issues: [] };
      await client.query(
        `insert into content.problem_versions
           (problem_id, version, public, review_status, auto_checks, provenance, reviewed_by, reviewed_at, published_at)
         values ($1, $2, $3::jsonb, 'published', $4::jsonb, $5::jsonb, $6, now(), now())`,
        [pkg.id, pkg.version, JSON.stringify(pkg.public), JSON.stringify(autoChecks), JSON.stringify(provenance), reviewerId],
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
    }

    // review_records 没有唯一键：按 (problem_id, version, reviewer, approve) 幂等写入。
    const recorded = await client.query(
      `select 1 from content.review_records
        where problem_id = $1 and version = $2 and reviewer_id = $3 and decision = 'approve'`,
      [pkg.id, pkg.version, reviewerId],
    );
    if (recorded.rows.length === 0) {
      await client.query(
        `insert into content.review_records (problem_id, version, reviewer_id, decision, minutes_spent)
         values ($1, $2, $3, 'approve', $4)`,
        [pkg.id, pkg.version, reviewerId, options.minutes],
      );
    }

    await client.query('COMMIT');
    return { ok: true, mode, issues: [] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
