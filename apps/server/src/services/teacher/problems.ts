import { checkCategories } from '@proof-gym/content-checks';
import type { ProblemPackage } from '@proof-gym/engine';

import type { Db, Queryable } from '../../db/index.ts';
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
  reviewSource?: 'teacher' | 'auto';
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
  reviewer: string | null;
  reviewed_at: string | null;
  review_source: 'teacher' | 'auto';
};

export interface ProblemListPage {
  items: ProblemListItemDto[];
  // 只在传了 limit 且还有下一页时有值。
  nextCursor: string | null;
}

// 分页与搜索（题库上千题时教师端用搜索下拉）：不传 limit = 返回全部（旧调用不变）；
// 传了 limit 就按（题号, 版本）稳定顺序分页，cursor 是上一页的 nextCursor。
export async function listProblemsPage(
  db: Queryable,
  filter: { status?: string; chapter?: string; q?: string; limit?: number; cursor?: string },
): Promise<ProblemListPage> {
  let after: [string, number] | null = null;
  if (filter.cursor !== undefined) {
    try {
      const parsed = JSON.parse(Buffer.from(filter.cursor, 'base64url').toString('utf8')) as unknown;
      if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || !Number.isInteger(parsed[1])) throw new Error('bad');
      after = [parsed[0], parsed[1] as number];
    } catch {
      throw new AppError('VALIDATION_FAILED', 422, 'cursor 不合法');
    }
  }
  const needle = (filter.q ?? '').trim().toLowerCase();
  const limit = filter.limit;
  const rows = (
    await db.query<ListRow>(
      `select p.id as problem_id, p.title, p.chapter, p.kind, v.version,
              v.review_status, v.auto_checks, v.provenance, v.review_source,
              coalesce(ru.display_name, ru.anon_code) as reviewer,
              rr.at::text as reviewed_at
         from content.problems p
         join content.problem_versions v
           on v.problem_id = p.id
          and (v.version = p.current_version or v.review_status in ('draft', 'pending', 'returned'))
         left join lateral (
           select r.reviewer_id, r.at from content.review_records r
            where r.problem_id = v.problem_id and r.version = v.version
            order by r.at desc limit 1
         ) rr on true
         left join app.users ru on ru.id = rr.reviewer_id
        where ($1::text is null or v.review_status = $1)
          and ($2::text is null or p.chapter = $2)
          and ($3 = '' or position($3 in lower(p.id || ' ' || p.title || ' ' || coalesce(p.chapter, ''))) > 0)
          and ($4::text is null or (p.id, v.version) > ($4::text, $5::int))
        order by p.id, v.version
        limit $6`,
      [filter.status ?? null, filter.chapter ?? null, needle, after?.[0] ?? null, after?.[1] ?? 0, limit === undefined ? null : limit + 1],
    )
  ).rows;

  const paged = limit !== undefined && rows.length > limit;
  const pageRows = paged ? rows.slice(0, limit) : rows;
  const items = pageRows.flatMap((row) =>
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
            reviewSource: row.review_source,
            ...(row.reviewer === null ? {} : { reviewedBy: row.reviewer }),
            ...(row.reviewed_at === null ? {} : { reviewedAt: new Date(row.reviewed_at).toISOString() }),
          },
        ],
  );
  const lastRow = pageRows.at(-1);
  return {
    items,
    nextCursor: paged && lastRow ? Buffer.from(JSON.stringify([lastRow.problem_id, lastRow.version])).toString('base64url') : null,
  };
}

export async function listProblems(
  db: Queryable,
  filter: { status?: string; chapter?: string },
): Promise<ProblemListItemDto[]> {
  return (await listProblemsPage(db, filter)).items;
}

type PackageRow = {
  public: Record<string, unknown>;
  review_status: ProblemListItemDto['status'];
  auto_checks: Record<string, unknown> | null;
  provenance: Record<string, unknown> | null;
  secret: Record<string, unknown> | null;
  reviewer: string | null;
  reviewed_at: string | null;
  comments: string | null;
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
      `select v.public, v.review_status, v.auto_checks, v.provenance, s.secret,
              coalesce(u.display_name, u.anon_code) as reviewer,
              v.reviewed_at::text as reviewed_at,
              r.comments
         from content.problem_versions v
         left join vault.problem_secrets s on s.problem_id = v.problem_id and s.version = v.version
         left join app.users u on u.id = v.reviewed_by
         left join lateral (
           select comments from content.review_records
            where problem_id = v.problem_id and version = v.version
            order by at desc limit 1
         ) r on true
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
    review: {
      status: row.review_status,
      autoChecks: row.auto_checks ?? {},
      ...(row.reviewer === null ? {} : { reviewer: row.reviewer }),
      ...(row.reviewed_at === null ? {} : { reviewedAt: row.reviewed_at }),
      ...(row.comments === null ? {} : { comments: row.comments }),
    },
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
  db: Db,
  actorId: string,
  problemId: string,
  version: number,
  input: ReviewInput,
): Promise<ProblemListItemDto> {
  // 审核结论 + 发布/退回/编辑必须原子：approve 切 current_version、edit 写新版本 + vault + review_records。
  return db.tx(async (tx) => reviewProblemTx(tx, actorId, problemId, version, input));
}

async function reviewProblemTx(
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
    if (input.edited === undefined) throw new AppError('VALIDATION_FAILED', 422, 'edit 需要 edited 题目包');
    return stageEditedVersion(db, actorId, problemId, version, input as EditedInput);
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


interface EditedInput extends ReviewInput {
  edited: Record<string, unknown>;
}

// 04 §8.2 的 edit：教师在审核屏直接改题目包 → 服务端重跑 S8（与 CLI 同一实现）→ 全绿才发布为新版本。
async function stageEditedVersion(
  db: Queryable,
  actorId: string,
  problemId: string,
  sourceVersion: number,
  input: EditedInput,
): Promise<ProblemListItemDto> {
  const editedInput = input.edited as unknown as ProblemPackage;
  if (editedInput.id !== problemId) {
    throw new AppError('VALIDATION_FAILED', 422, `edited.id（${String(editedInput.id)}）与题目 ID 不一致`);
  }
  // GET 的 ProblemPackageView 不含 referenceProofs（vault 单独存）；编辑回传时补空数组再跑 S8。
  const rawSecret = { ...(editedInput.secret as unknown as Record<string, unknown>) };
  // ProblemPackageView 的 secret 不含 referenceProofs；编辑未提供时沿用源版本（参考证明不随标题等编辑丢失）。
  if (!Array.isArray(rawSecret.referenceProofs) || rawSecret.referenceProofs.length === 0) {
    const sourceProofs = (
      await db.query<{ proof_id: string; route: number | null; text: string; publishable: boolean }>(
        `select proof_id, route, text, publishable from vault.reference_proofs where problem_id = $1 and version = $2 order by proof_id`,
        [problemId, sourceVersion],
      )
    ).rows;
    rawSecret.referenceProofs = sourceProofs.map((proof) => ({
      id: proof.proof_id,
      ...(proof.route === null ? {} : { route: proof.route }),
      text: proof.text,
      publishable: proof.publishable,
    }));
  }
  if (!Array.isArray(rawSecret.referenceProofs) || rawSecret.referenceProofs.length === 0) {
    throw new AppError('VALIDATION_FAILED', 422, '编辑未提供参考证明，且源版本没有可沿用的参考证明');
  }
  const edited = { ...editedInput, secret: rawSecret } as unknown as ProblemPackage;
  const checks = checkCategories(edited);
  if (!checks.ok) {
    throw new AppError('VALIDATION_FAILED', 422, '修改后的题目包未通过 S8 校验', { issues: checks.issues });
  }

  // 锁题目行，避免两个教师同时 edit 拿到同一个 nextVersion（并发写新版本）。
  await db.query(`select id from content.problems where id = $1 for update`, [problemId]);
  const maxRow = await db.query<{ max: number | null }>(
    `select max(version) as max from content.problem_versions where problem_id = $1`,
    [problemId],
  );
  const nextVersion = Number(maxRow.rows[0]?.max ?? 0) + 1;
  const publicPart = edited.public as unknown as Record<string, unknown>;
  const secret: Record<string, unknown> = { ...(edited.secret as unknown as Record<string, unknown>) };
  const proofs = Array.isArray(secret.referenceProofs)
    ? (secret.referenceProofs as Array<{ id: string; route?: number; text: string; publishable?: boolean }>)
    : [];
  delete secret.referenceProofs;

  await db.query(
    `insert into content.problem_versions
       (problem_id, version, public, review_status, auto_checks, provenance, reviewed_by, reviewed_at, published_at)
     values ($1, $2, $3::jsonb, 'published', $4::jsonb, $5::jsonb, $6, now(), now())`,
    [problemId, nextVersion, JSON.stringify(publicPart), JSON.stringify(checks.categories), JSON.stringify({ source: 'teacher-edit', fromVersion: sourceVersion }), actorId],
  );
  await db.query(
    `update content.problems set current_version = greatest(coalesce(current_version, 0), $2) where id = $1`,
    [problemId, nextVersion],
  );
  await db.query(
    `insert into vault.problem_secrets (problem_id, version, secret) values ($1, $2, $3::jsonb)`,
    [problemId, nextVersion, JSON.stringify(secret)],
  );
  for (const proof of proofs) {
    await db.query(
      `insert into vault.reference_proofs (problem_id, version, proof_id, route, text, publishable)
       values ($1, $2, $3, $4, $5, $6)`,
      [problemId, nextVersion, proof.id, proof.route ?? null, proof.text, proof.publishable ?? true],
    );
  }
  await db.query(
    `insert into content.review_records (problem_id, version, reviewer_id, decision, comments, minutes_spent)
     values ($1, $2, $3, 'edit', $4, $5)`,
    [problemId, nextVersion, actorId, input.comments ?? null, input.minutes ?? 0],
  );
  await db.query(
    `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'review_problem', $2, $3::jsonb)`,
    [actorId, `${problemId}@v${nextVersion}`, JSON.stringify({ decision: 'edit', fromVersion: sourceVersion })],
  );

  return {
    problemId,
    title: String(publicPart.title ?? problemId),
    ...(typeof publicPart.chapter === 'string' ? { chapter: publicPart.chapter } : {}),
    kind: (edited.kind ?? 'main') as ProblemListItemDto['kind'],
    version: nextVersion,
    status: 'published',
    autoChecks: { ...checks.categories },
  };
}
