import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { assertClassTeacher, requireTeacher, uuidParam } from '../../services/teacher/auth.ts';
import { createClass, listClasses, rotateInviteCode, type CreateClassInput } from '../../services/teacher/classes.ts';
import { importRoster } from '../../services/teacher/roster.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface ClassIdParams {
  classId: string;
}

export const teacherClassRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  // 我的班级（04 §1、06 §3.6）
  app.get('/teacher/classes', async (request) => {
    const auth = await requireTeacher(db, request);
    const classes = await listClasses(db, auth);
    for (const item of classes) contract.validate('ClassSummary', item);
    return classes;
  });

  // 建班（生成邀请码）
  app.post('/teacher/classes', async (request, reply) => {
    const auth = await requireTeacher(db, request);
    contract.validateRequest('/teacher/classes', 'post', request.body);
    const body = request.body as CreateClassInput;
    const summary = await createClass(db, auth, body);
    contract.validate('ClassSummary', summary);
    return reply.status(201).send(summary);
  });

  // 名单 CSV 导入（04 §10）。契约的请求体是 text/csv，contract.validateRequest 只支持 JSON，这里不做 JSON 校验。
  app.post('/teacher/classes/:classId/roster', async (request) => {
    const auth = await requireTeacher(db, request);
    const classId = uuidParam((request.params as ClassIdParams).classId, '班级');
    await assertClassTeacher(db, auth, classId);
    if (!Buffer.isBuffer(request.body)) {
      throw new AppError('VALIDATION_FAILED', 422, '请求体必须是 CSV 文件（text/csv）');
    }
    return importRoster(db, config, classId, request.body);
  });

  // 重置邀请码（04 §10：旧码立即失效，已登录学生不受影响）
  app.post('/teacher/classes/:classId/invite-code', async (request) => {
    const auth = await requireTeacher(db, request);
    const classId = uuidParam((request.params as ClassIdParams).classId, '班级');
    const summary = await rotateInviteCode(db, auth, classId);
    contract.validate('ClassSummary', summary);
    return summary;
  });
};
