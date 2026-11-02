import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Db } from './index.ts';

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
  public: { title?: string; chapter?: string };
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
         on conflict (problem_id, version) do nothing`,
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
