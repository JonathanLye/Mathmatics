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
         join content.problem_versions v on v.problem_id = p.id and v.version = p.current_version
        where ($1::text is null or v.review_status = $1)
          and ($2::text is null or p.chapter = $2)
        order by p.id`,
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
