import type { FastifyPluginAsync } from 'fastify';

import { requireStudentConsent } from '../auth/consent.ts';
import { bySession, requireStudent } from '../auth/session.ts';
import { createIdempotency } from '../idempotency.ts';
import { buildProgress, loadSettings, patchSettings, submitFeedback, type SettingsPatch } from '../progress/service.ts';

import type { AuthRouteOptions } from './auth.ts';

// 学生设置、进度与反馈（06 §3.1）。设置与反馈要求已签同意书（和作答接口同一个守卫）；
// 进度只读，和首页一样不要求同意书。
export const progressRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  const idempotency = createIdempotency(db);
  const consented = { preHandler: [requireStudentConsent(db)] };

  app.get('/student/progress', async (request) => {
    const auth = await requireStudent(db, request);
    return buildProgress(db, contract, auth.userId);
  });

  app.get('/student/settings', consented, async (request) => {
    const auth = await requireStudent(db, request);
    return loadSettings(db, contract, auth.userId);
  });

  app.patch('/student/settings', consented, async (request) => {
    const auth = await requireStudent(db, request);
    contract.validateRequest('/student/settings', 'patch', request.body);
    return patchSettings(db, contract, auth.userId, request.body as SettingsPatch);
  });

  app.post(
    '/student/feedback',
    {
      preHandler: [requireStudentConsent(db), idempotency.preHandler],
      onSend: idempotency.onSend,
      config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: bySession } },
    },
    async (request, reply) => {
      const auth = await requireStudent(db, request);
      contract.validateRequest('/student/feedback', 'post', request.body);
      await submitFeedback(db, auth.userId, request.body as { kind: 'bug' | 'idea' | 'content' | 'other'; body: string; page?: string });
      void reply.status(204);
      return reply.send();
    },
  );
};
