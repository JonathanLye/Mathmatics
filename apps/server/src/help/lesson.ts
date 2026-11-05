import { deserializeState, gateRule, type SerializedAttemptState } from '@proof-gym/engine';

import type { AttemptService } from '../attempts/service.ts';
import { loadProblem } from '../attempts/problem.ts';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

// 06 §4.4 / openapi /attempts/{id}/lesson/{conceptId}[/check]：预写微课（概念库已发布词条），不调用模型。
// 下发给学生的每个字符串都过规则闸门（09 §7.1，豁免本作答已写出的 key）；被拦的字符串换成回退文案，不整体报错。
// 小核验题的 answer / right / wrong 不下发：学生选一项后由 /check 判定并给反馈。
const GATE_FALLBACK = '这一段我先不展开。你现在写到哪一行了？这一行的依据是什么？';

interface CheckQuestion {
  q: string;
  options: string[];
  answer: number;
  right: string;
  wrong: string;
}
interface LessonStepBody {
  id: string;
  kind: string;
  text: string;
  visual?: unknown;
  check?: CheckQuestion;
}
interface ConceptBody {
  title?: string;
  card?: { plain?: string; map?: Array<[string, string]>; distortion?: string; boundary?: CheckQuestion };
  lesson?: { steps?: LessonStepBody[] };
}

export interface LessonService {
  get(userId: string, attemptId: string, conceptId: string): Promise<Record<string, unknown>>;
  check(userId: string, attemptId: string, conceptId: string, input: { stepId: string; choice: number }): Promise<Record<string, unknown>>;
}

export function createLessonService(deps: { db: Db; attempts: AttemptService }): LessonService {
  const { db, attempts } = deps;

  async function load(userId: string, attemptId: string, conceptId: string) {
    const row = (
      await db.query<{ user_id: string; problem_id: string; problem_version: number; state: SerializedAttemptState }>(
        `select user_id, problem_id, problem_version, state from app.attempts where id = $1`,
        [attemptId],
      )
    ).rows[0];
    if (!row || row.user_id !== userId) throw new AppError('NOT_FOUND', 404, '找不到这次作答');
    const concept = (
      await db.query<{ body: ConceptBody }>(
        `select body from content.concepts where id = $1 and status = 'published' order by version desc limit 1`,
        [conceptId],
      )
    ).rows[0]?.body;
    if (!concept || !Array.isArray(concept.lesson?.steps)) throw new AppError('NOT_FOUND', 404, '没有这个概念的微课');
    const problem = await loadProblem(db, row.problem_id, row.problem_version);
    const exempt = new Set(deserializeState(row.state).hint.matched);
    const secret = problem.ctx.pkg.secret;
    const gate = (text: string): string => (gateRule(secret, text, exempt, []).ok ? text : GATE_FALLBACK);
    return { concept, gate, steps: concept.lesson.steps };
  }

  return {
    async get(userId, attemptId, conceptId) {
      const { concept, gate, steps } = await load(userId, attemptId, conceptId);
      const card = concept.card;
      return {
        conceptId,
        title: gate(concept.title ?? conceptId),
        card: {
          plain: gate(card?.plain ?? ''),
          map: (card?.map ?? []).map(([a, b]) => [gate(a), gate(b)]),
          distortion: gate(card?.distortion ?? ''),
          ...(card?.boundary ? { boundary: { q: gate(card.boundary.q), options: card.boundary.options.map(gate) } } : {}),
        },
        steps: steps.map((s) => ({
          id: s.id,
          kind: s.kind,
          text: gate(s.text),
          ...(s.visual === undefined ? {} : { visual: s.visual }),
          ...(s.check ? { check: { q: gate(s.check.q), options: s.check.options.map(gate) } } : {}),
        })),
        generated: null,
        currentStepId: steps[0]?.id,
      };
    },

    async check(userId, attemptId, conceptId, { stepId, choice }) {
      const { gate, steps } = await load(userId, attemptId, conceptId);
      const index = steps.findIndex((s) => s.id === stepId);
      const step = steps[index];
      if (!step?.check) throw new AppError('VALIDATION_FAILED', 422, '这一步没有小核验');
      if (choice >= step.check.options.length) throw new AppError('VALIDATION_FAILED', 422, '没有这个选项');
      const correct = choice === step.check.answer;
      return {
        correct,
        feedback: gate(correct ? `对。${step.check.right}` : step.check.wrong),
        nextStepId: correct ? (steps[index + 1]?.id ?? null) : stepId,
        state: await attempts.get(userId, attemptId),
      };
    },
  };
}
