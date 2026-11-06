import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Db, Queryable } from './index.ts';

interface ReferenceProof {
  id: string;
  route?: number;
  text: string;
  publishable?: boolean;
}

interface ProblemPackage {
  id: string;
  version: number;
  kind: 'main' | 'transfer';
  public: { title?: string; chapter?: string; concepts?: string[] };
  secret: Record<string, unknown> & { referenceProofs?: ReferenceProof[] };
  review?: { status?: string; autoChecks?: unknown };
  provenance?: unknown;
}

interface Concept {
  id: string;
  kind: 'definition' | 'frame';
  title: string;
  review?: { status?: string };
}

interface GlossaryTerm {
  id: string;
  triggers: string[];
  answer: string;
  layers?: string[];
}

interface ConceptsDocument {
  concepts: Concept[];
  glossary: GlossaryTerm[];
}

export interface SeedSummary {
  problems: number;
  concepts: number;
  glossary: number;
}

const SEED_DIR = dirname(fileURLToPath(import.meta.resolve('@proof-gym/contracts/seed/epsN.json')));

function isProblemPackage(value: unknown): value is ProblemPackage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.public === 'object' &&
    candidate.public !== null &&
    typeof candidate.secret === 'object' &&
    candidate.secret !== null
  );
}

const CN_DIGITS: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// “第十二章 数项级数” → { no: 12, title: '数项级数' }；解析不了就排在最后。
export function parseChapter(chapter: string | undefined, fallbackNo: number): { no: number; title: string } {
  const m = /^第\s*([0-9]+|[零一二三四五六七八九十]+)\s*章\s*(.*)$/.exec(chapter ?? '');
  if (!m) return { no: fallbackNo, title: chapter ?? '其他' };
  const raw = m[1] as string;
  let no: number;
  if (/^[0-9]+$/.test(raw)) no = Number(raw);
  else if (raw === '十') no = 10;
  else if (raw.startsWith('十')) no = 10 + (CN_DIGITS[raw.slice(1)] ?? 0);
  else if (raw.includes('十')) no = (CN_DIGITS[raw[0] as string] ?? 0) * 10 + (CN_DIGITS[raw.slice(2)] ?? 0);
  else no = CN_DIGITS[raw] ?? fallbackNo;
  return { no, title: m[2] || (chapter as string) };
}

// 学习路径：一个课程 math-analysis，按章切单元（每章一个单元），单元里是该章已发布的主题。可重复执行。
// 批量导入工具生成的单元用同一张表；这里只为全新安装保证首页有路径可走。
async function seedCoursePath(tx: Queryable, packages: ProblemPackage[]): Promise<void> {
  await tx.query(
    `insert into content.courses (id, title, sort) values ('math-analysis', '数学分析', 0)
     on conflict (id) do update set title = excluded.title`,
  );
  const mains = packages.filter((p) => p.kind === 'main' && (p.review?.status ?? 'published') === 'published');
  const byChapter = new Map<number, { title: string; ids: string[]; concepts: Set<string> }>();
  mains.forEach((pkg, index) => {
    const { no, title } = parseChapter(pkg.public.chapter, 100 + index);
    const entry = byChapter.get(no) ?? { title, ids: [], concepts: new Set<string>() };
    entry.ids.push(pkg.id);
    for (const concept of pkg.public.concepts ?? []) entry.concepts.add(concept);
    byChapter.set(no, entry);
  });
  let sort = 0;
  for (const [no, entry] of [...byChapter.entries()].sort(([a], [b]) => a - b)) {
    sort += 1;
    const unit = (
      await tx.query<{ id: string }>(
        `insert into content.course_units (course_id, chapter_no, unit_no, title, summary, concept_ids, sort)
         values ('math-analysis', $1, 1, $2, $3, $4::text[], $5)
         on conflict (course_id, chapter_no, unit_no) do update set title = excluded.title, concept_ids = excluded.concept_ids, sort = excluded.sort
         returning id`,
        [no, entry.title, `${entry.title}：先分层练习，再写总结。`, [...entry.concepts], sort],
      )
    ).rows[0];
    if (!unit) continue;
    let order = 0;
    for (const id of entry.ids.sort()) {
      order += 1;
      await tx.query(
        `insert into content.unit_items (unit_id, problem_id, sort) values ($1, $2, $3)
         on conflict (unit_id, problem_id) do nothing`,
        [unit.id, id, order],
      );
    }
  }
}

export async function seedContent(db: Db): Promise<SeedSummary> {
  const problemFiles = readdirSync(SEED_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'concepts.json')
    .sort();
  const packages = problemFiles
    .map((file) => JSON.parse(readFileSync(join(SEED_DIR, file), 'utf8')) as unknown)
    .filter(isProblemPackage);
  const conceptsDocument = JSON.parse(
    readFileSync(join(SEED_DIR, 'concepts.json'), 'utf8'),
  ) as ConceptsDocument;

  return db.tx(async (tx) => {
    for (const pkg of packages) {
      const reviewStatus = pkg.review?.status ?? 'published';
      const chapter = pkg.public.chapter ?? null;

      await tx.query(
        `insert into content.problems (id, kind, title, chapter, current_version)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set current_version = excluded.current_version`,
        [pkg.id, pkg.kind, pkg.public.title ?? pkg.id, chapter, pkg.version],
      );

      await tx.query(
        `insert into content.problem_versions
           (problem_id, version, public, review_status, auto_checks, provenance, published_at)
         values ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, now())
         on conflict (problem_id, version) do nothing`,
        [
          pkg.id,
          pkg.version,
          JSON.stringify(pkg.public),
          reviewStatus,
          JSON.stringify(pkg.review?.autoChecks ?? {}),
          JSON.stringify(pkg.provenance ?? {}),
        ],
      );

      const secret: Record<string, unknown> = { ...pkg.secret };
      const proofs = Array.isArray(secret.referenceProofs)
        ? (secret.referenceProofs as ReferenceProof[])
        : [];
      delete secret.referenceProofs;

      await tx.query(
        `insert into vault.problem_secrets (problem_id, version, secret)
         values ($1, $2, $3::jsonb)
         on conflict (problem_id, version) do update set secret = excluded.secret`,
        [pkg.id, pkg.version, JSON.stringify(secret)],
      );

      for (const proof of proofs) {
        await tx.query(
          `insert into vault.reference_proofs (problem_id, version, proof_id, route, text, publishable)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (problem_id, version, proof_id) do nothing`,
          [pkg.id, pkg.version, proof.id, proof.route ?? null, proof.text, proof.publishable ?? true],
        );
      }
    }

    await seedCoursePath(tx, packages);

    for (const concept of conceptsDocument.concepts) {
      await tx.query(
        `insert into content.concepts (id, version, kind, title, body, status)
         values ($1, $2, $3, $4, $5::jsonb, $6)
         on conflict (id, version) do nothing`,
        [
          concept.id,
          1,
          concept.kind,
          concept.title,
          JSON.stringify(concept),
          concept.review?.status ?? 'published',
        ],
      );
    }

    for (const term of conceptsDocument.glossary) {
      await tx.query(
        `insert into content.glossary (id, triggers, answer, layers, status)
         values ($1, $2::text[], $3, $4::text[], 'published')
         on conflict (id) do nothing`,
        [term.id, term.triggers, term.answer, term.layers ?? null],
      );
    }

    return {
      problems: packages.length,
      concepts: conceptsDocument.concepts.length,
      glossary: conceptsDocument.glossary.length,
    };
  });
}
