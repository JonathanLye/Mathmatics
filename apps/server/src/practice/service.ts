import type { ContractValidator } from '../contract.ts';
import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { appendServerEvent } from '../recognition/service.ts';
import {
  ELIGIBLE_FROM,
  ELIGIBLE_WHERE,
  difficultyBand,
  hasOpenTest,
  progressByProblem,
  stemPreview,
  type DifficultyBand,
  type ProblemProgress,
} from '../path/common.ts';

export type RevealLevel = 'none' | 'approach' | 'full';
const LEVEL_RANK: Record<RevealLevel, number> = { none: 0, approach: 1, full: 2 };

export interface PracticeQuery {
  chapter?: string;
  difficulty?: DifficultyBand;
  status?: 'todo' | 'active' | 'done';
  q?: string;
  cursor?: string;
  limit?: number;
}

type LightRow = { id: string; chapter: string; chapter_no: number; diff: string | null };
interface Light {
  id: string;
  chapter: string;
  chapterNo: number;
  diff: number;
  band: DifficultyBand;
  status: 'todo' | 'active' | 'done';
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const NO_CHAPTER_NO = 9999;

function compare(a: { chapterNo: number; chapter: string; diff: number; id: string }, b: typeof a): number {
  return a.chapterNo - b.chapterNo || a.chapter.localeCompare(b.chapter, 'zh') || a.diff - b.diff || a.id.localeCompare(b.id);
}

function encodeCursor(row: Light): string {
  return Buffer.from(JSON.stringify([row.chapterNo, row.chapter, row.diff, row.id])).toString('base64url');
}

function decodeCursor(raw: string): { chapterNo: number; chapter: string; diff: number; id: string } {
  try {
    const [chapterNo, chapter, diff, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (typeof chapterNo !== 'number' || typeof chapter !== 'string' || typeof diff !== 'number' || typeof id !== 'string') {
      throw new Error('bad cursor');
    }
    return { chapterNo, chapter, diff, id };
  } catch {
    throw new AppError('VALIDATION_FAILED', 422, 'cursor 不合法');
  }
}

export interface PracticeService {
  list(userId: string, query: PracticeQuery): Promise<Record<string, unknown>>;
  random(userId: string, filter: { chapter?: string; difficulty?: DifficultyBand }): Promise<Record<string, unknown>>;
  solution(userId: string, problemId: string): Promise<Record<string, unknown>>;
  reveal(userId: string, problemId: string, level: 'approach' | 'full'): Promise<Record<string, unknown>>;
}

// 奖励口径需要知道一次自学作答里学生看了解答的哪一级：approach 之后写出的关键步骤按“有提示”计，
// full 之后不再给关键步骤经验与“无提示通关”徽章。奖励计算（computeRewards）读这个函数，不在这里算奖励。
export async function revealLevelFor(q: Queryable, attemptId: string): Promise<RevealLevel> {
  const rows = (
    await q.query<{ level: 'approach' | 'full' }>(`select level from app.solution_reveals where attempt_id = $1`, [attemptId])
  ).rows;
  return rows.reduce<RevealLevel>((best, row) => (LEVEL_RANK[row.level] > LEVEL_RANK[best] ? row.level : best), 'none');
}

export function createPracticeService(deps: { db: Db; contract: ContractValidator }): PracticeService {
  const { db, contract } = deps;

  // 一次读出全部可练题的排序键（不读题面）；1000 题也只是几十 KB。
  async function lightList(userId: string, q: string | undefined): Promise<Light[]> {
    const needle = q?.trim().toLowerCase() ?? '';
    const rows = (
      await db.query<LightRow>(
        `select p.id, coalesce(p.chapter, '') as chapter, pv.public->>'difficulty' as diff,
                coalesce((select min(cu.chapter_no) from content.unit_items ui
                            join content.course_units cu on cu.id = ui.unit_id
                           where ui.problem_id = p.id), ${NO_CHAPTER_NO}) as chapter_no
           ${ELIGIBLE_FROM}
          where ${ELIGIBLE_WHERE}
            and ($2 = '' or position($2 in lower(p.title || ' ' || coalesce(p.chapter, '') || ' '
                  || coalesce(pv.public->>'stem', '') || ' ' || coalesce(pv.public->>'tags', ''))) > 0)
            and not exists (
              select 1 from app.assignments a
                join app.class_members m on m.class_id = a.class_id and m.user_id = $1 and m.left_at is null
               where a.problem_id = p.id and a.mode = 'test' and a.origin = 'teacher'
                 and a.status in ('scheduled', 'open') and (a.close_at is null or a.close_at > now()))`,
        [userId, needle],
      )
    ).rows;
    const progress = await progressByProblem(db, userId);
    return rows
      .map((row): Light => {
        const diff = row.diff === null ? 3 : Number(row.diff);
        const p = progress.get(row.id);
        return {
          id: row.id,
          chapter: row.chapter,
          chapterNo: Number(row.chapter_no),
          diff,
          band: difficultyBand(diff),
          status: p === undefined ? 'todo' : p.attemptStatus === 'completed' ? 'done' : 'active',
        };
      })
      .sort(compare);
  }

  async function items(userId: string, rows: Light[]): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const detail = new Map(
      (
        await db.query<{
          id: string;
          title: string;
          stem: string | null;
          tags: string[] | null;
          section: string | null;
          source_book: string | null;
          key_count: string | null;
          review_source: 'teacher' | 'auto';
        }>(
          `select p.id, p.title, left(pv.public->>'stem', 700) as stem, pv.public->'tags' as tags,
                  pv.public#>>'{source,section}' as section, pv.public#>>'{source,book}' as source_book,
                  pv.public->>'keyCount' as key_count, pv.review_source
             ${ELIGIBLE_FROM}
            where ${ELIGIBLE_WHERE} and p.id = any($1::text[])`,
          [rows.map((r) => r.id)],
        )
      ).rows.map((r) => [r.id, r]),
    );
    const progress = await progressByProblem(db, userId);
    return rows.flatMap((row) => {
      const d = detail.get(row.id);
      if (!d) return [];
      const item: Record<string, unknown> = {
        problemId: row.id,
        title: d.title,
        stemPreview: stemPreview(d.stem),
        chapter: row.chapter,
        difficulty: row.band,
        tags: d.tags ?? [],
        status: row.status,
        attemptId: progress.get(row.id)?.attemptId ?? null,
        keyCount: d.key_count === null ? 0 : Number(d.key_count),
        autoImported: d.review_source === 'auto',
      };
      if (d.section !== null) item.section = d.section;
      if (d.source_book !== null) item.sourceBook = d.source_book;
      return [item];
    });
  }

  async function list(userId: string, query: PracticeQuery): Promise<Record<string, unknown>> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const all = await lightList(userId, query.q);
    const pass = (row: Light, skip: 'chapter' | 'difficulty' | null): boolean =>
      (skip === 'chapter' || query.chapter === undefined || row.chapter === query.chapter) &&
      (skip === 'difficulty' || query.difficulty === undefined || row.band === query.difficulty) &&
      (query.status === undefined || row.status === query.status);

    // 分面：章分面不受章筛选影响，难度分面不受难度筛选影响，这样侧栏能看到“换个选项会有多少题”。
    const chapters: { chapter: string; total: number; done: number }[] = [];
    for (const row of all.filter((r) => pass(r, 'chapter'))) {
      let entry = chapters.find((c) => c.chapter === row.chapter);
      if (!entry) {
        entry = { chapter: row.chapter, total: 0, done: 0 };
        chapters.push(entry);
      }
      entry.total += 1;
      if (row.status === 'done') entry.done += 1;
    }
    const difficulty = { easy: 0, medium: 0, hard: 0 };
    for (const row of all.filter((r) => pass(r, 'difficulty'))) difficulty[row.band] += 1;

    const filtered = all.filter((r) => pass(r, null));
    let from = 0;
    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);
      from = filtered.findIndex((r) => compare(r, after) > 0);
      if (from === -1) from = filtered.length;
    }
    const page = filtered.slice(from, from + limit);
    const last = page.at(-1);
    const dto = {
      items: await items(userId, page),
      facets: { chapters, difficulty },
      nextCursor: last !== undefined && from + limit < filtered.length ? encodeCursor(last) : null,
    };
    contract.validate('PracticeList', dto);
    return dto;
  }

  async function random(userId: string, filter: { chapter?: string; difficulty?: DifficultyBand }): Promise<Record<string, unknown>> {
    const candidates = (await lightList(userId, undefined)).filter(
      (row) =>
        row.status !== 'done' &&
        (filter.chapter === undefined || row.chapter === filter.chapter) &&
        (filter.difficulty === undefined || row.band === filter.difficulty),
    );
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    if (!pick) throw new AppError('NOT_FOUND', 404, '这个范围里的题你都做过了，换个章节或难度试试');
    const [item] = await items(userId, [pick]);
    if (!item) throw new AppError('NOT_FOUND', 404, '这个范围里的题你都做过了，换个章节或难度试试');
    contract.validate('PracticeItem', item);
    return item;
  }

  type Walkthrough = { approach: string; keyIdeas: string[]; pitfalls?: string[] };

  async function loadContent(q: Queryable, problemId: string, version: number): Promise<{ walkthrough: Walkthrough | null; proof: string | null }> {
    const secret = (
      await q.query<{ walkthrough: Walkthrough | null }>(
        `select secret->'walkthrough' as walkthrough from vault.problem_secrets where problem_id = $1 and version = $2`,
        [problemId, version],
      )
    ).rows[0];
    const proof = (
      await q.query<{ text: string }>(
        `select text from vault.reference_proofs
          where problem_id = $1 and version = $2 and publishable
          order by route nulls last, proof_id limit 1`,
        [problemId, version],
      )
    ).rows[0];
    return { walkthrough: secret?.walkthrough ?? null, proof: proof?.text ?? null };
  }

  // 学生此刻可以看到的解答级别：完成了 → full；否则取他主动看过的最高一级。
  // 测验类作答要等布置结束才算“完成即可看”；班里这题还有没结束的测验时，一律不给。
  async function visibleLevel(userId: string, problemId: string, progress: ProblemProgress | undefined): Promise<RevealLevel> {
    if (await hasOpenTest(db, userId, problemId)) return 'none';
    if (progress?.attemptStatus === 'completed' && (progress.mode !== 'test' || progress.assignmentClosed)) return 'full';
    const rows = (
      await db.query<{ level: 'approach' | 'full' }>(
        `select level from app.solution_reveals where user_id = $1 and problem_id = $2`,
        [userId, problemId],
      )
    ).rows;
    return rows.reduce<RevealLevel>((best, row) => (LEVEL_RANK[row.level] > LEVEL_RANK[best] ? row.level : best), 'none');
  }

  async function solution(userId: string, problemId: string): Promise<Record<string, unknown>> {
    const found = (
      await db.query<{ version: number; review_source: 'teacher' | 'auto' }>(
        `select pv.version, pv.review_source ${ELIGIBLE_FROM} where ${ELIGIBLE_WHERE} and p.id = $1`,
        [problemId],
      )
    ).rows[0];
    if (!found) throw new AppError('NOT_FOUND', 404, '这道题现在不能练习');
    const progress = (await progressByProblem(db, userId)).get(problemId);
    const level = await visibleLevel(userId, problemId, progress);
    const content = await loadContent(db, problemId, found.version);

    const blocked = await hasOpenTest(db, userId, problemId);
    const dto: Record<string, unknown> = {
      level,
      canReveal:
        !blocked && progress?.origin === 'path' && progress.mode === 'practice' && progress.attemptStatus !== 'completed' && level !== 'full',
      hasApproach: content.walkthrough !== null,
      hasFull: content.proof !== null,
      aiGenerated: found.review_source === 'auto',
    };
    if (level !== 'none' && content.walkthrough) {
      dto.approach = content.walkthrough.approach;
      dto.keyIdeas = content.walkthrough.keyIdeas;
    }
    if (level === 'full') {
      if (content.walkthrough?.pitfalls) dto.pitfalls = content.walkthrough.pitfalls;
      if (content.proof !== null) dto.referenceProof = content.proof;
    }
    contract.validate('PracticeSolution', dto);
    return dto;
  }

  async function reveal(userId: string, problemId: string, level: 'approach' | 'full'): Promise<Record<string, unknown>> {
    const found = (
      await db.query<{ version: number }>(`select pv.version ${ELIGIBLE_FROM} where ${ELIGIBLE_WHERE} and p.id = $1`, [problemId])
    ).rows[0];
    if (!found) throw new AppError('NOT_FOUND', 404, '这道题现在不能练习');
    if (await hasOpenTest(db, userId, problemId)) {
      throw new AppError('TEST_MODE_RESTRICTED', 403, '这道题老师正在用作测验，现在不能查看解答');
    }

    await db.tx(async (tx) => {
      // 只认学生自己的、练习模式的自学作答（origin='path'）。老师布置的作答、测验作答一律不行。
      const attempt = (
        await tx.query<{ id: string; status: string }>(
          `select a.id, a.status
             from app.attempts a
             join app.assignments asg on asg.id = a.assignment_id
            where a.user_id = $1 and a.problem_id = $2 and a.kind = 'main'
              and a.mode = 'practice' and asg.origin = 'path' and a.status <> 'abandoned'
            order by (a.status = 'completed') desc, a.started_at desc
            limit 1
              for update of a`,
          [userId, problemId],
        )
      ).rows[0];
      if (!attempt) {
        const teacherAttempt = (
          await tx.query(
            `select 1 from app.attempts a join app.assignments asg on asg.id = a.assignment_id
              where a.user_id = $1 and a.problem_id = $2 and a.kind = 'main' and asg.origin = 'teacher' limit 1`,
            [userId, problemId],
          )
        ).rows;
        if (teacherAttempt.length > 0) {
          throw new AppError('TEST_MODE_RESTRICTED', 403, '老师布置的题不能在这里查看解答');
        }
        throw new AppError('VALIDATION_FAILED', 409, '先开始做这道题，再来看思路');
      }
      if (attempt.status === 'completed') return; // 已完成：本来就能看全部，不记查看。

      const content = await loadContent(tx, problemId, found.version);
      if (content.walkthrough === null && (level === 'approach' || content.proof === null)) {
        throw new AppError('NOT_FOUND', 404, '这道题还没有整理好的解答');
      }
      const inserted = (
        await tx.query(
          `insert into app.solution_reveals (user_id, attempt_id, problem_id, level)
           values ($1, $2, $3, $4)
           on conflict (user_id, problem_id, level) do nothing
           returning level`,
          [userId, attempt.id, problemId, level],
        )
      ).rows;
      if (inserted.length === 0) return;
      await appendServerEvent(tx, attempt.id, 'solution.revealed', { level, problemId });
      if (level === 'full') {
        await tx.query(
          `insert into vault.reference_access_log (user_id, problem_id, version, purpose) values ($1, $2, $3, 'review')`,
          [userId, problemId, found.version],
        );
      }
    });
    return solution(userId, problemId);
  }

  return { list, random, solution, reveal };
}

