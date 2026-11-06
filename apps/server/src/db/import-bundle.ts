import { gunzipSync } from 'node:zlib';

import { runImportGates } from '@proof-gym/content-checks';
import type { ConceptsFile, ProblemPackage } from '@proof-gym/engine';

import type { Db, Queryable } from './index.ts';

// 批量导入题发布（U16，10 §6.1）：一次性容器经标准输入读 bundle，不开隧道、不加管理接口。
// 每题一个事务，单题失败不影响其它题；按内容哈希幂等，重复导入什么都不改。
// 服务端再跑一遍门禁：本机生成的文件也不当可信输入。
export const SERVICE_REVIEWER_CODE = 'T-AI-IMPORT';

interface BundleHeader {
  type: 'header';
  batchId: string;
  course: { id: string; title: string };
}

interface BundleUnit {
  type: 'unit';
  chapterNo: number;
  unitNo: number;
  title: string;
  summary: string;
  conceptIds: string[];
  sort: number;
  items: string[];
}

interface BundleProblem {
  type: 'problem';
  contentHash: string;
  quality: number;
  band: string;
  pathEligible: boolean;
  unit: { chapterNo: number; unitNo: number };
  pkg: ProblemPackage;
}

type BundleLine = BundleHeader | BundleUnit | BundleProblem;

export interface ImportSummary {
  batchId: string;
  inserted: number;
  newVersions: number;
  unchanged: number;
  rejected: Array<{ problemId: string; reason: string }>;
  units: number;
  unitItems: number;
}

export function parseBundle(buffer: Buffer): BundleLine[] {
  const text = (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer).toString('utf8');
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as BundleLine);
}

// 服务审核账号：只用来满足 reviewed_by / review_records 的外键。disabled 且没有 teacher_accounts，登录不了。
export async function ensureServiceReviewer(db: Queryable): Promise<string> {
  const row = await db.query<{ id: string }>(
    `insert into app.users (role, anon_code, display_name, status)
     values ('teacher', $1, 'AI 整理', 'disabled')
     on conflict (anon_code) do update set status = 'disabled'
     returning id`,
    [SERVICE_REVIEWER_CODE],
  );
  return row.rows[0]?.id as string;
}

type ProblemResult = 'inserted' | 'new_version' | 'unchanged';

async function upsertProblem(tx: Queryable, line: BundleProblem, reviewerId: string, autoChecks: unknown): Promise<ProblemResult> {
  const pkg = line.pkg;
  const latest = (
    await tx.query<{ version: number; review_status: string; hash: string | null }>(
      `select version, review_status, provenance->>'contentHash' as hash
         from content.problem_versions
        where problem_id = $1
        order by version desc
        limit 1`,
      [pkg.id],
    )
  ).rows[0];

  if (latest !== undefined && latest.hash === line.contentHash) {
    // 同内容已存在。若那一行还停在草稿（publish.ts 的老坑），补成已发布，否则学生永远看不到。
    if (latest.review_status !== 'published') {
      await tx.query(
        `update content.problem_versions
            set review_status = 'published', review_source = 'auto', reviewed_by = $3, reviewed_at = now(), published_at = now()
          where problem_id = $1 and version = $2`,
        [pkg.id, latest.version, reviewerId],
      );
      await tx.query(`update content.problems set current_version = $2 where id = $1`, [pkg.id, latest.version]);
      return 'new_version';
    }
    return 'unchanged';
  }

  const version = (latest?.version ?? 0) + 1;
  await tx.query(
    `insert into content.problems (id, kind, title, chapter, current_version)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set kind = excluded.kind, title = excluded.title,
       chapter = excluded.chapter, current_version = excluded.current_version`,
    [pkg.id, pkg.kind ?? 'main', pkg.public.title, pkg.public.chapter, version],
  );
  await tx.query(
    `insert into content.problem_versions
       (problem_id, version, public, review_status, review_source, auto_checks, provenance, reviewed_by, reviewed_at, published_at)
     values ($1, $2, $3::jsonb, 'published', 'auto', $4::jsonb, $5::jsonb, $6, now(), now())`,
    [
      pkg.id,
      version,
      JSON.stringify(pkg.public),
      JSON.stringify(autoChecks),
      JSON.stringify({ ...(pkg.provenance ?? {}), contentHash: line.contentHash, quality: line.quality }),
      reviewerId,
    ],
  );
  const secret: Record<string, unknown> = { ...pkg.secret };
  const proofs = pkg.secret.referenceProofs;
  delete secret.referenceProofs;
  await tx.query(`insert into vault.problem_secrets (problem_id, version, secret) values ($1, $2, $3::jsonb)`, [
    pkg.id,
    version,
    JSON.stringify(secret),
  ]);
  for (const proof of proofs) {
    await tx.query(
      `insert into vault.reference_proofs (problem_id, version, proof_id, route, text, publishable)
       values ($1, $2, $3, $4, $5, $6)`,
      [pkg.id, version, proof.id, proof.route ?? null, proof.text, proof.publishable ?? true],
    );
  }
  await tx.query(
    `insert into content.review_records (problem_id, version, reviewer_id, decision, comments, minutes_spent)
     values ($1, $2, $3, 'approve', 'U16 自动校验通过后发布', 0)`,
    [pkg.id, version, reviewerId],
  );
  return latest === undefined ? 'inserted' : 'new_version';
}

async function upsertUnit(tx: Queryable, courseId: string, unit: BundleUnit, available: ReadonlySet<string>): Promise<number> {
  const row = await tx.query<{ id: string }>(
    `insert into content.course_units (course_id, chapter_no, unit_no, title, summary, concept_ids, sort)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (course_id, chapter_no, unit_no) do update set title = excluded.title, summary = excluded.summary,
       concept_ids = excluded.concept_ids, sort = excluded.sort
     returning id`,
    [courseId, unit.chapterNo, unit.unitNo, unit.title, unit.summary, unit.conceptIds, unit.sort],
  );
  const unitId = row.rows[0]?.id as string;
  const items = unit.items.filter((id) => available.has(id));
  // 重新导入时路径挑题可能变：先清掉这个单元里不再入选的题。
  await tx.query(`delete from content.unit_items where unit_id = $1 and not (problem_id = any($2::text[]))`, [unitId, items]);
  for (const [index, problemId] of items.entries()) {
    await tx.query(
      `insert into content.unit_items (unit_id, problem_id, sort) values ($1, $2, $3)
       on conflict (unit_id, problem_id) do update set sort = excluded.sort`,
      [unitId, problemId, index],
    );
  }
  return items.length;
}

async function loadConcepts(db: Queryable): Promise<ConceptsFile> {
  const concepts = await db.query<{ body: { id: string } }>(`select distinct on (id) body from content.concepts order by id, version desc`);
  const glossary = await db.query<{ id: string; answer: string }>(`select id, answer from content.glossary`);
  return { concepts: concepts.rows.map((row) => row.body), glossary: glossary.rows };
}

export async function importBundle(db: Db, lines: readonly unknown[]): Promise<ImportSummary> {
  const parsed = lines as BundleLine[];
  const header = parsed.find((line): line is BundleHeader => line.type === 'header');
  if (header === undefined) throw new Error('bundle 缺少 header 行');
  const reviewerId = await ensureServiceReviewer(db);
  await db.query(`insert into content.courses (id, title) values ($1, $2) on conflict (id) do nothing`, [header.course.id, header.course.title]);
  const concepts = await loadConcepts(db);

  const summary: ImportSummary = { batchId: header.batchId, inserted: 0, newVersions: 0, unchanged: 0, rejected: [], units: 0, unitItems: 0 };
  const available = new Set<string>();
  for (const line of parsed) {
    if (line.type !== 'problem') continue;
    const problemId = line.pkg?.id ?? '(未知)';
    try {
      const gates = runImportGates(line.pkg, concepts);
      if (!gates.ok) {
        summary.rejected.push({ problemId, reason: gates.issues.slice(0, 3).map((issue) => `${issue.where}: ${issue.message}`).join(' | ') });
        continue;
      }
      const result = await db.tx((tx) => upsertProblem(tx, line, reviewerId, gates.categories));
      if (result === 'inserted') summary.inserted += 1;
      else if (result === 'new_version') summary.newVersions += 1;
      else summary.unchanged += 1;
      available.add(problemId);
    } catch (error) {
      summary.rejected.push({ problemId, reason: (error as Error).message.slice(0, 300) });
    }
  }
  for (const line of parsed) {
    if (line.type !== 'unit') continue;
    const count = await db.tx((tx) => upsertUnit(tx, header.course.id, line, available));
    summary.units += 1;
    summary.unitItems += count;
  }
  return summary;
}

export async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
