import type { Queryable } from '../../db/index.ts';
import { AppError } from '../../errors.ts';

// 04 §8 审核屏 / openapi /teacher/problems：列表 + 完整题目包（含 secret，仅教师/审核角色）。
export interface ProblemListItemDto {
  problemId: string;
  title: string;
  chapter?: string;
  kind: 'main' | 'transfer';
  version: number;
  status: 'draft' | 'pending' | 'returned' | 'published' | 'retired';
  autoChecks?: Record<string, unknown>;
  source?: string;
}

type ListRow = {
  problem_id: string;
  title: string;
  chapter: string | null;
  kind: 'main' | 'transfer';
  version: number | null;
  review_status: ProblemListItemDto['status'];
  auto_checks: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
};

export async function listProblems(
  db: Queryable,
  filter: { status?: string; chapter?: string },
): Promise<ProblemListItemDto[]> {
  const rows = (
    await db.query<ListRow>(
      `select p.id as problem_id, p.title, p.chapter, p.kind, p.current_version as version,
              v.review_status, v.auto_checks, v.provenance
         from content.problems p
         join content.problem_versions v
           on v.problem_id = p.id
          and (v.version = p.current_version or v.review_status in ('draft', 'pending', 'returned'))
        where ($1::text is null or v.review_status = $1)
          and ($2::text is null or p.chapter = $2)
        order by p.id, v.version`,
      [filter.status ?? null, filter.chapter ?? null],
    )
  ).rows;

  return rows.flatMap((row) =>
    row.version === null
      ? []
      : [
          {
            problemId: row.problem_id,
            title: row.title,
            ...(row.chapter === null ? {} : { chapter: row.chapter }),
            kind: row.kind,
            version: row.version,
            status: row.review_status,
            autoChecks: row.auto_checks ?? {},
            ...(typeof row.provenance?.source === 'string' ? { source: row.provenance.source } : {}),
          },
        ],
  );
}

type PackageRow = {
  public: Record<string, unknown>;
  review_status: ProblemListItemDto['status'];
  auto_checks: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  secret: Record<string, unknown> | null;
};

// 完整题目包：public 来自 content.problem_versions，secret 来自 vault.problem_secrets（B 的发布路径）。
// 参考证明不在这里返回（vault.reference_proofs 单独存，读它记审计，见 04 §8/09 §6）。
export async function getProblemVersion(
  db: Queryable,
  actorId: string,
  problemId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const row = (
    await db.query<PackageRow>(
      `select v.public, v.review_status, v.auto_checks, v.provenance, s.secret
         from content.problem_versions v
         left join vault.problem_secrets s on s.problem_id = v.problem_id and s.version = v.version
        where v.problem_id = $1 and v.version = $2`,
      [problemId, version],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '题目版本不存在');
  if (row.secret === null) throw new AppError('INTERNAL', 500, '题目包缺少 secret');

  const problem = (
    await db.query<{ kind: 'main' | 'transfer'; title: string }>(
      `select kind, title from content.problems where id = $1`,
      [problemId],
    )
  ).rows[0];

  await db.query(
    `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'read_problem', $2, $3::jsonb)`,
    [actorId, `${problemId}@v${version}`, JSON.stringify({ problemId, version })],
  );

  return {
    schemaVersion: '1.0',
    id: problemId,
    version,
    kind: problem?.kind ?? 'main',
    public: row.public,
    secret: row.secret,
    review: { status: row.review_status, autoChecks: row.auto_checks ?? {} },
    ...(row.provenance === null ? {} : { provenance: row.provenance }),
  };
}


// 04 §8.2：审核结论。approve 要求四项自动校验全绿（由导入流水线 S8 写入 auto_checks）；
// 本接口只做“读取+发布/退回”，不重算 S8（避免与 apps/import 双实现漂移）。
const REQUIRED_CHECKS = ['schema', 'katex', 'leakExhaustive', 'patternSelfTest'] as const;

export interface ReviewInput {
  decision: 'approve' | 'return' | 'edit';
  comments?: string;
  edited?: Record<string, unknown>;
  minutes?: number;
}

type VersionRow = {
  review_status: ProblemListItemDto['status'];
  auto_checks: Record<string, unknown> | null;
};

export async function reviewProblem(
  db: Queryable,
  actorId: string,
  problemId: string,
  version: number,
  input: ReviewInput,
): Promise<ProblemListItemDto> {
  const row = (
    await db.query<VersionRow>(
      `select review_status, auto_checks from content.problem_versions where problem_id = $1 and version = $2`,
      [problemId, version],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '题目版本不存在');

  if (input.decision === 'edit') {
    throw new AppError('VALIDATION_FAILED', 422, 'edit 尚未实现：需要 S8 复跑后写入新版本（#42 后续）');
  }

  if (input.decision === 'approve') {
    const checks = row.auto_checks ?? {};
    const missing = REQUIRED_CHECKS.filter((name) => checks[name] !== true);
    if (missing.length > 0) {
      throw new AppError('VALIDATION_FAILED', 422, `自动校验未全绿：${missing.join(', ')}`, { missing });
    }
    if (row.review_status !== 'published') {
      await db.query(
        `update content.problem_versions
            set review_status = 'published', reviewed_by = $3, reviewed_at = now(), published_at = now()
          where problem_id = $1 and version = $2`,
        [problemId, version, actorId],
      );
      await db.query(
        `update content.problems set current_version = greatest(coalesce(current_version, 0), $2) where id = $1`,
        [problemId, version],
      );
    }
    await db.query(
      `insert into content.review_records (problem_id, version, reviewer_id, decision, comments, minutes_spent)
       values ($1, $2, $3, 'approve', $4, $5)`,
      [problemId, version, actorId, input.comments ?? null, input.minutes ?? 0],
    );
  } else {
    await db.query(`update content.problem_versions set review_status = 'returned' where problem_id = $1 and version = $2`, [
      problemId,
      version,
    ]);
    await db.query(
      `insert into content.review_records (problem_id, version, reviewer_id, decision, comments, minutes_spent)
       values ($1, $2, $3, 'return', $4, $5)`,
      [problemId, version, actorId, input.comments ?? null, input.minutes ?? 0],
    );
  }

  const item = (
    await db.query<ListRow>(
      `select p.id as problem_id, p.title, p.chapter, p.kind, v.version,
              v.review_status, v.auto_checks, v.provenance
         from content.problems p
         join content.problem_versions v on v.problem_id = p.id and v.version = $2
        where p.id = $1`,
      [problemId, version],
    )
  ).rows[0];
  if (!item || item.version === null) throw new AppError('NOT_FOUND', 404, '题目版本不存在');
  return {
    problemId: item.problem_id,
    title: item.title,
    ...(item.chapter === null ? {} : { chapter: item.chapter }),
    kind: item.kind,
    version: item.version,
    status: item.review_status,
    autoChecks: item.auto_checks ?? {},
  };
}
