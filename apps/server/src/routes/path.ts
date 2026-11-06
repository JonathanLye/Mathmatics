import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { createAttemptService } from '../attempts/service.ts';
import { requireStudentConsent } from '../auth/consent.ts';
import { requireStudent } from '../auth/session.ts';
import { AppError } from '../errors.ts';
import { createIdempotency } from '../idempotency.ts';
import { BAND_ORDER, type DifficultyBand } from '../path/common.ts';
import { createPathService } from '../path/service.ts';
import { createPracticeService, type PracticeQuery } from '../practice/service.ts';

import type { AuthRouteOptions } from './auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROBLEM_ID = /^[A-Za-z0-9_.-]{1,64}$/;

function problemIdParam(request: FastifyRequest): string {
  const raw = (request.params as Record<string, string>).problemId ?? '';
  if (!PROBLEM_ID.test(raw)) throw new AppError('NOT_FOUND', 404, '找不到这道题');
  return raw;
}

function bandOf(raw: unknown): DifficultyBand | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || !BAND_ORDER.includes(raw as DifficultyBand)) {
    throw new AppError('VALIDATION_FAILED', 422, 'difficulty 只能是 easy / medium / hard');
  }
  return raw as DifficultyBand;
}

function textOf(raw: unknown, name: string, max = 80): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > max) throw new AppError('VALIDATION_FAILED', 422, `${name} 不合法`);
  return raw;
}

// 学习路径（Task 11）、练习区（Task 16）与讲评（GET /attempts/{id}/review）。
export const pathRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  const attempts = createAttemptService(db, contract);
  const path = createPathService({ db, contract, attempts });
  const practice = createPracticeService({ db, contract });
  const idempotency = createIdempotency(db);
  const writable = { preHandler: [requireStudentConsent(db), idempotency.preHandler], onSend: idempotency.onSend };

  const classIdOf = (request: FastifyRequest): string | undefined => {
    const body = request.body as { classId?: unknown } | undefined | null;
    if (body === undefined || body === null || body.classId === undefined) return undefined;
    if (typeof body.classId !== 'string' || !UUID.test(body.classId)) {
      throw new AppError('VALIDATION_FAILED', 422, 'classId 不是合法 UUID');
    }
    return body.classId;
  };

  app.get('/student/path', async (request) => {
    const auth = await requireStudent(db, request);
    const unit = (request.query as { unit?: unknown }).unit;
    if (unit !== undefined && (typeof unit !== 'string' || !UUID.test(unit))) {
      throw new AppError('VALIDATION_FAILED', 422, 'unit 不是合法 UUID');
    }
    return path.get(auth.userId, unit as string | undefined);
  });

  app.post('/student/path/items/:problemId/start', writable, async (request) => {
    const auth = await requireStudent(db, request);
    return path.start(auth.userId, problemIdParam(request), classIdOf(request));
  });

  app.get('/student/practice', async (request) => {
    const auth = await requireStudent(db, request);
    const q = request.query as Record<string, unknown>;
    const status = q.status;
    if (status !== undefined && status !== '' && status !== 'todo' && status !== 'active' && status !== 'done') {
      throw new AppError('VALIDATION_FAILED', 422, 'status 只能是 todo / active / done');
    }
    let limit: number | undefined;
    if (q.limit !== undefined && q.limit !== '') {
      limit = Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1) throw new AppError('VALIDATION_FAILED', 422, 'limit 不合法');
    }
    const query: PracticeQuery = {};
    const chapter = textOf(q.chapter, 'chapter');
    const difficulty = bandOf(q.difficulty);
    const text = textOf(q.q, 'q', 60);
    const cursor = textOf(q.cursor, 'cursor', 400);
    if (chapter !== undefined) query.chapter = chapter;
    if (difficulty !== undefined) query.difficulty = difficulty;
    if (status === 'todo' || status === 'active' || status === 'done') query.status = status;
    if (text !== undefined) query.q = text;
    if (cursor !== undefined) query.cursor = cursor;
    if (limit !== undefined) query.limit = limit;
    return practice.list(auth.userId, query);
  });

  app.post('/student/practice/random', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const body = (request.body ?? {}) as { chapter?: unknown; difficulty?: unknown };
    const filter: { chapter?: string; difficulty?: DifficultyBand } = {};
    const chapter = textOf(body.chapter, 'chapter');
    const difficulty = bandOf(body.difficulty);
    if (chapter !== undefined) filter.chapter = chapter;
    if (difficulty !== undefined) filter.difficulty = difficulty;
    return practice.random(auth.userId, filter);
  });

  app.post('/student/practice/:problemId/start', writable, async (request) => {
    const auth = await requireStudent(db, request);
    return path.start(auth.userId, problemIdParam(request), classIdOf(request));
  });

  app.get('/student/practice/:problemId/solution', async (request) => {
    const auth = await requireStudent(db, request);
    return practice.solution(auth.userId, problemIdParam(request));
  });

  app.post('/student/practice/:problemId/solution/reveal', writable, async (request) => {
    const auth = await requireStudent(db, request);
    const level = (request.body as { level?: unknown } | undefined | null)?.level;
    if (level !== 'approach' && level !== 'full') {
      throw new AppError('VALIDATION_FAILED', 422, 'level 只能是 approach 或 full');
    }
    return practice.reveal(auth.userId, problemIdParam(request), level);
  });
};
