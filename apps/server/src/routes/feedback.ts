import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { requireStudentConsent } from '../auth/consent.ts';
import { bySession, requireApp, requireStudent, type AuthContext } from '../auth/session.ts';
import { AppError } from '../errors.ts';
import {
  CATEGORIES,
  STATUSES,
  confirmFeedbackBug,
  feedbackIdOf,
  getInboxItem,
  getMyFeedback,
  listInbox,
  listMyFeedback,
  patchInboxItem,
  replyInboxItem,
  replyMyFeedback,
  submitFeedback,
  type FeedbackCategory,
  type FeedbackKind,
  type FeedbackStatus,
  type InboxPatch,
} from '../feedback/service.ts';
import { createIdempotency } from '../idempotency.ts';

import type { AuthRouteOptions } from './auth.ts';

// 反馈信箱（15-反馈与信箱.md）。
// 学生：提交、列表、对话、追加回复（提交/回复要求已签同意书，读自己的不要求）。
// 开发者：/teacher/feedback*，只有 admin 角色（教师 403）。路径放在 /teacher 下是因为用教师端的登录与页面。
export const feedbackRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  const idempotency = createIdempotency(db);
  const writeGuard = { preHandler: [requireStudentConsent(db), idempotency.preHandler], onSend: idempotency.onSend };

  const requireDeveloper = async (request: FastifyRequest): Promise<AuthContext> => {
    const auth = await requireApp(db, request, 'teacher');
    if (auth.role !== 'admin') throw new AppError('FORBIDDEN', 403, '只有开发者账号可以看反馈');
    return auth;
  };
  const idParam = (request: FastifyRequest): string => feedbackIdOf((request.params as { feedbackId: string }).feedbackId);

  // ---------------------------------------------------------- 学生
  app.post(
    '/student/feedback',
    { ...writeGuard, config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: bySession } } },
    async (request, reply) => {
      const auth = await requireStudent(db, request);
      contract.validateRequest('/student/feedback', 'post', request.body);
      const receipt = await submitFeedback(db, auth.userId, request.body as { kind: FeedbackKind; body: string; page?: string; context?: unknown });
      return reply.status(201).send(receipt);
    },
  );

  app.get('/student/feedback', async (request) => {
    const auth = await requireStudent(db, request);
    return listMyFeedback(db, auth.userId);
  });

  app.get('/student/feedback/:feedbackId', async (request) => {
    const auth = await requireStudent(db, request);
    return getMyFeedback(db, auth.userId, idParam(request));
  });

  app.post(
    '/student/feedback/:feedbackId/messages',
    { ...writeGuard, config: { rateLimit: { max: 20, timeWindow: '1 minute', keyGenerator: bySession } } },
    async (request, reply) => {
      const auth = await requireStudent(db, request);
      contract.validateRequest('/student/feedback/{feedbackId}/messages', 'post', request.body);
      const message = await replyMyFeedback(db, auth.userId, idParam(request), (request.body as { body: string }).body);
      return reply.status(201).send(message);
    },
  );

  // ---------------------------------------------------------- 开发者
  app.get('/teacher/feedback', async (request) => {
    await requireDeveloper(request);
    const q = request.query as Record<string, string | undefined>;
    const oneOf = <T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined => {
      if (value === undefined || value === '') return undefined;
      if (!(allowed as readonly string[]).includes(value)) throw new AppError('VALIDATION_FAILED', 422, `${label}不合法`);
      return value as T;
    };
    const int = (value: string | undefined, fallback: number, min: number, max: number, label: string): number => {
      if (value === undefined || value === '') return fallback;
      const n = Number(value);
      if (!Number.isInteger(n) || n < min || n > max) throw new AppError('VALIDATION_FAILED', 422, `${label}不合法`);
      return n;
    };
    const status = oneOf<FeedbackStatus>(q.status, STATUSES, 'status');
    const category = oneOf<FeedbackCategory>(q.category, CATEGORIES, 'category');
    if (q.q !== undefined && q.q.length > 80) throw new AppError('VALIDATION_FAILED', 422, 'q 太长');
    if (q.area !== undefined && q.area.length > 40) throw new AppError('VALIDATION_FAILED', 422, 'area 太长');
    return listInbox(db, {
      ...(status === undefined ? {} : { status }),
      ...(category === undefined ? {} : { category }),
      ...(q.area ? { area: q.area } : {}),
      ...(q.unread === 'true' ? { unread: true } : {}),
      ...(q.q ? { q: q.q } : {}),
      limit: int(q.limit, 30, 1, 100, 'limit'),
      offset: int(q.offset, 0, 0, 1_000_000, 'offset'),
    });
  });

  app.get('/teacher/feedback/:feedbackId', async (request) => {
    await requireDeveloper(request);
    return getInboxItem(db, idParam(request));
  });

  app.patch('/teacher/feedback/:feedbackId', async (request) => {
    const auth = await requireDeveloper(request);
    contract.validateRequest('/teacher/feedback/{feedbackId}', 'patch', request.body);
    return patchInboxItem(db, auth.userId, idParam(request), request.body as InboxPatch);
  });

  app.post('/teacher/feedback/:feedbackId/messages', async (request, reply) => {
    const auth = await requireDeveloper(request);
    contract.validateRequest('/teacher/feedback/{feedbackId}/messages', 'post', request.body);
    const detail = await replyInboxItem(db, auth.userId, idParam(request), request.body as { body: string; setStatus?: 'need_info' | 'resolved' });
    return reply.status(201).send(detail);
  });

  app.post('/teacher/feedback/:feedbackId/confirm', async (request) => {
    const auth = await requireDeveloper(request);
    if (request.body !== undefined) contract.validateRequest('/teacher/feedback/{feedbackId}/confirm', 'post', request.body);
    return confirmFeedbackBug(db, auth.userId, idParam(request), (request.body as { note?: string } | undefined)?.note);
  });
};
