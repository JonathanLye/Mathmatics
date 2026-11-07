import type { FastifyPluginAsync } from 'fastify';

import { requireStudentConsent } from '../auth/consent.ts';
import { requireStudent } from '../auth/session.ts';
import { buildProgress, loadSettings, patchSettings, type SettingsPatch } from '../progress/service.ts';

import type { AuthRouteOptions } from './auth.ts';

// 学生设置与进度（06 §3.1）。设置要求已签同意书（和作答接口同一个守卫）；
// 进度只读，和首页一样不要求同意书。反馈已移到 feedback.ts（15 号文档）。
export const progressRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
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
};
