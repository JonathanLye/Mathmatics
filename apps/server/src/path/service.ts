import type { ContractValidator } from '../contract.ts';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { studentHome } from '../attempts/home.ts';
import type { AttemptService } from '../attempts/service.ts';

import {
  ELIGIBLE_FROM,
  ELIGIBLE_WHERE,
  assertNoOpenTest,
  difficultyBand,
  layersDoneOf,
  nodeStateOf,
  progressByProblem,
  reviewOpenFor,
  stemPreview,
  studentClasses,
  type NodeState,
  type ProblemProgress,
} from './common.ts';

export const COURSE_ID = 'math-analysis';
// 单元完成到这个比例就开放下一单元：一道有问题的导入题不会卡死整条路径。
export const UNLOCK_RATIO = 0.6;

type UnitRow = {
  id: string;
  chapter_no: number;
  unit_no: number;
  title: string;
  summary: string;
  concept_ids: string[];
};
type PairRow = { unit_id: string; problem_id: string; chapter: string | null };

interface UnitSummary {
  id: string;
  chapterNo: number;
  unitNo: number;
  title: string;
  summary: string;
  total: number;
  done: number;
  state: NodeState;
  locked: boolean;
}

// 在 start 之外的纯函数，便于测试：第 i 个单元是否被软锁（上一个有题的单元完成不到 60%）。
export function unitLocked(prev: { total: number; done: number } | null): boolean {
  if (prev === null) return false;
  return prev.total > 0 && prev.done < prev.total * UNLOCK_RATIO;
}

export interface PathService {
  get(userId: string, unitId: string | undefined): Promise<Record<string, unknown>>;
  start(userId: string, problemId: string, classId?: string): Promise<Record<string, unknown>>;
}

export function createPathService(deps: { db: Db; contract: ContractValidator; attempts: AttemptService }): PathService {
  const { db, contract, attempts } = deps;

  async function get(userId: string, unitId: string | undefined): Promise<Record<string, unknown>> {
    const course = (
      await db.query<{ id: string; title: string }>(`select id, title from content.courses order by sort, id limit 1`)
    ).rows[0];
    if (!course) {
      const empty = { course: null, units: [], current: null, teacherAssignments: [], chapters: [] };
      contract.validate('StudentPath', empty);
      return empty;
    }

    const unitRows = (
      await db.query<UnitRow>(
        `select id, chapter_no, unit_no, title, summary, concept_ids
           from content.course_units where course_id = $1 order by chapter_no, unit_no, sort`,
        [course.id],
      )
    ).rows;
    // 单元里能练的题（只取 id，不读题面）。已下架、不完整、测试卷/备用题不在其中。
    const pairs = (
      await db.query<PairRow>(
        `select ui.unit_id, ui.problem_id, p.chapter
           ${ELIGIBLE_FROM}
           join content.unit_items ui on ui.problem_id = p.id
           join content.course_units cu on cu.id = ui.unit_id and cu.course_id = $1
          where ${ELIGIBLE_WHERE}
          order by cu.chapter_no, cu.unit_no, ui.sort, p.id`,
        [course.id],
      )
    ).rows;
    const progress = await progressByProblem(db, userId);

    const itemsByUnit = new Map<string, string[]>();
    const chapterText = new Map<number, string>();
    const chapterOfUnit = new Map<string, number>(unitRows.map((u) => [u.id, u.chapter_no]));
    for (const pair of pairs) {
      const list = itemsByUnit.get(pair.unit_id) ?? [];
      list.push(pair.problem_id);
      itemsByUnit.set(pair.unit_id, list);
      const no = chapterOfUnit.get(pair.unit_id);
      if (no !== undefined && pair.chapter !== null && !chapterText.has(no)) chapterText.set(no, pair.chapter);
    }

    const units: UnitSummary[] = [];
    let previous: { total: number; done: number } | null = null;
    for (const unit of unitRows) {
      const ids = itemsByUnit.get(unit.id) ?? [];
      if (ids.length === 0) continue;
      const done = ids.filter((id) => nodeStateOf(progress.get(id)) === 'done').length;
      const started = ids.some((id) => progress.has(id));
      units.push({
        id: unit.id,
        chapterNo: unit.chapter_no,
        unitNo: unit.unit_no,
        title: unit.title,
        summary: unit.summary,
        total: ids.length,
        done,
        state: done === ids.length ? 'done' : started ? 'active' : 'todo',
        locked: unitLocked(previous),
      });
      previous = { total: ids.length, done };
    }

    let currentSummary: UnitSummary | undefined;
    if (unitId !== undefined) {
      currentSummary = units.find((u) => u.id === unitId);
      if (!currentSummary) throw new AppError('NOT_FOUND', 404, '找不到这个单元');
    } else {
      currentSummary = units.find((u) => u.state !== 'done') ?? units.at(-1);
    }

    let current: Record<string, unknown> | null = null;
    if (currentSummary) {
      const unit = unitRows.find((u) => u.id === currentSummary.id) as UnitRow;
      const ids = itemsByUnit.get(unit.id) ?? [];
      current = {
        ...currentSummary,
        conceptIds: unit.concept_ids,
        concepts: await conceptTitles(unit.concept_ids),
        items: await unitItems(ids, progress),
      };
    }

    const chapters: Record<string, unknown>[] = [];
    for (const unit of units) {
      let chapter = chapters.find((c) => c.chapterNo === unit.chapterNo);
      if (!chapter) {
        chapter = {
          chapterNo: unit.chapterNo,
          chapter: chapterText.get(unit.chapterNo) ?? `第 ${unit.chapterNo} 章`,
          firstUnitId: unit.id,
          unitCount: 0,
          total: 0,
          done: 0,
        };
        chapters.push(chapter);
      }
      (chapter.unitCount as number) += 1;
      (chapter.total as number) += unit.total;
      (chapter.done as number) += unit.done;
    }

    const dto = {
      course: { id: course.id, title: course.title },
      units,
      current,
      teacherAssignments: await pinnedTeacherAssignments(userId),
      chapters,
    };
    contract.validate('StudentPath', dto);
    return dto;
  }

  async function conceptTitles(ids: string[]): Promise<{ id: string; title: string }[]> {
    if (ids.length === 0) return [];
    const rows = (
      await db.query<{ id: string; title: string }>(
        `select distinct on (id) id, title from content.concepts
          where id = any($1::text[]) and status = 'published' order by id, version desc`,
        [ids],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, r.title]));
    return ids.flatMap((id) => (byId.has(id) ? [{ id, title: byId.get(id) as string }] : []));
  }

  async function unitItems(ids: string[], progress: Map<string, ProblemProgress>): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    const rows = (
      await db.query<{
        id: string;
        title: string;
        stem: string | null;
        difficulty: string | null;
        key_count: string | null;
        review_source: 'teacher' | 'auto';
        has_lesson: boolean;
        layers_total: string;
      }>(
        `select p.id, p.title, left(pv.public->>'stem', 700) as stem, pv.public->>'difficulty' as difficulty,
                pv.public->>'keyCount' as key_count, pv.review_source,
                exists (
                  select 1 from content.concepts c
                   where c.id = pv.public#>>'{def,conceptId}' and c.status = 'published'
                     and c.body#>'{lesson,steps}' is not null) as has_lesson,
                (select count(*) from jsonb_each(pv.public->'layers') l where (l.value->>'enabled')::boolean) as layers_total
           ${ELIGIBLE_FROM}
          where ${ELIGIBLE_WHERE} and p.id = any($1::text[])`,
        [ids],
      )
    ).rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    // 软锁：同一单元里，排在第一道未完成题之后、且还没开始的题。只提示，不拦。
    const frontier = ids.findIndex((id) => nodeStateOf(progress.get(id)) !== 'done');
    return ids.flatMap((problemId, index) => {
      const row = byId.get(problemId);
      if (!row) return [];
      const p = progress.get(problemId);
      const state = nodeStateOf(p);
      const item: Record<string, unknown> = {
        problemId,
        title: row.title,
        stemPreview: stemPreview(row.stem),
        difficulty: difficultyBand(row.difficulty === null ? null : Number(row.difficulty)),
        state,
        currentLayer: p?.currentLayer ?? null,
        layersDone: layersDoneOf(p),
        layersTotal: Number(row.layers_total),
        attemptId: p?.attemptId ?? null,
        reviewPublished: reviewOpenFor(p),
        autoImported: row.review_source === 'auto',
        softLocked: state === 'todo' && frontier !== -1 && index > frontier,
        lessonAvailable: row.has_lesson,
      };
      return [item];
    });
  }

  // 置顶的老师布置：开放中、没做完的教师布置，截止早的在前。
  async function pinnedTeacherAssignments(userId: string): Promise<Record<string, unknown>[]> {
    const home = await studentHome(db, contract, userId);
    const cards = [...(home.inProgress as Record<string, unknown>[]), ...(home.todo as Record<string, unknown>[])];
    return cards
      .filter((card) => card.status === 'open')
      .sort((a, b) => {
        const x = a.closeAt === null ? Infinity : new Date(a.closeAt as string).getTime();
        const y = b.closeAt === null ? Infinity : new Date(b.closeAt as string).getTime();
        return x - y;
      });
  }

  // 从路径或练习区开始一道题：
  //  1. 先过测验撞车守卫（班里这题有没结束的测验就拒绝）；
  //  2. 已经做完 → 返回只读回看；已有进行中的作答 → 续上；
  //  3. 班里有开放的教师练习布置 → 复用；否则懒创建本班的自学布置（origin='path'）。
  async function start(userId: string, problemId: string, classId?: string): Promise<Record<string, unknown>> {
    const found = (
      await db.query<{ version: number }>(
        `select pv.version ${ELIGIBLE_FROM} where ${ELIGIBLE_WHERE} and p.id = $1`,
        [problemId],
      )
    ).rows[0];
    if (!found) throw new AppError('NOT_FOUND', 404, '这道题现在不能练习');

    await assertNoOpenTest(db, userId, problemId);

    const existing = (await progressByProblem(db, userId)).get(problemId);
    if (existing?.attemptStatus === 'completed') {
      return { state: await attempts.get(userId, existing.attemptId) };
    }
    if (existing) {
      return { state: await attempts.start(userId, existing.assignmentId) };
    }

    const classes = await studentClasses(db, userId);
    const chosen = classId === undefined ? classes[0] : classes.find((c) => c.classId === classId);
    if (!chosen) {
      throw new AppError('NOT_FOUND', 404, classId === undefined ? '先加入班级才能练习' : '找不到这个班级');
    }

    // 教师在本班布置了开放中的练习：复用它（引擎、作答与老师布置的同一份）。
    const teacherPractice = (
      await db.query<{ id: string }>(
        `select id from app.assignments
          where class_id = $1 and problem_id = $2 and origin = 'teacher' and mode = 'practice'
            and status = 'open' and open_at <= now() and (close_at is null or close_at > now())
          order by open_at desc limit 1`,
        [chosen.classId, problemId],
      )
    ).rows[0]?.id;
    let assignmentId = teacherPractice;
    if (!assignmentId) {
      // open_at 往前挪一分钟：attempts.start 用应用时钟比较，避免两个时钟差几毫秒时第一次点击被拒。
      await db.query(
        `insert into app.assignments
           (class_id, problem_id, problem_version, mode, open_at, status, origin, created_by)
         values ($1, $2, $3, 'practice', now() - interval '1 minute', 'open', 'path', $4)
         on conflict (class_id, problem_id, problem_version) where origin = 'path' do nothing`,
        [chosen.classId, problemId, found.version, chosen.ownerId],
      );
      assignmentId = (
        await db.query<{ id: string }>(
          `select id from app.assignments
            where class_id = $1 and problem_id = $2 and problem_version = $3 and origin = 'path'`,
          [chosen.classId, problemId, found.version],
        )
      ).rows[0]?.id;
      if (!assignmentId) throw new AppError('INTERNAL', 500, '自学布置创建失败');
    }
    return { state: await attempts.start(userId, assignmentId) };
  }

  return { get, start };
}
