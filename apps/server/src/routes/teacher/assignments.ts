import type { FastifyPluginAsync } from 'fastify';

import {
  createAssignment,
  publishReview,
  updateAssignment,
  type AssignmentInput,
  type PublishReviewInput,
} from '../../services/teacher/assignments.ts';
import { requireTeacher, uuidParam } from '../../services/teacher/auth.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface AssignmentIdParams {
  assignmentId: string;
}

export const teacherAssignmentRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  // 布置练习/测验（04 §7）
  app.post('/teacher/assignments', async (request, reply) => {
    const auth = await requireTeacher(db, request);
    contract.validateRequest('/teacher/assignments', 'post', request.body);
    const card = await createAssignment(db, auth.userId, request.body as AssignmentInput);
    contract.validate('AssignmentCard', card);
    return reply.status(201).send(card);
  });

  // 修改布置（契约是 AssignmentCreate 全量 body）
  app.patch('/teacher/assignments/:assignmentId', async (request) => {
    const auth = await requireTeacher(db, request);
    const assignmentId = uuidParam((request.params as AssignmentIdParams).assignmentId, '布置');
    contract.validateRequest('/teacher/assignments/{assignmentId}', 'patch', request.body);
    const card = await updateAssignment(db, auth.userId, assignmentId, request.body as AssignmentInput);
    contract.validate('AssignmentCard', card);
    return card;
  });

  // 题目关闭后发布参考证明与讲评（04 §6）
  app.post('/teacher/assignments/:assignmentId/publish-review', async (request) => {
    const auth = await requireTeacher(db, request);
    const assignmentId = uuidParam((request.params as AssignmentIdParams).assignmentId, '布置');
    const body = (request.body ?? {}) as PublishReviewInput;
    // 契约的 body 可选；畸形 proofIds（非字符串数组）必须 422，不能让新 Set(...) 抛成 500。
    contract.validateRequest('/teacher/assignments/{assignmentId}/publish-review', 'post', body);
    const card = await publishReview(db, auth.userId, assignmentId, body);
    contract.validate('AssignmentCard', card);
    return card;
  });
};
