import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { requireTeacher, uuidParam } from '../../services/teacher/auth.ts';
import { buildLiveSnapshot } from '../../services/teacher/live.ts';
import { buildClassMetrics } from '../../services/teacher/metrics.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface ClassIdParams {
  classId: string;
}
interface LiveQuery {
  assignmentId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assignmentQuery(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new AppError('VALIDATION_FAILED', 422, 'assignmentId 不是合法 UUID');
  }
  return raw;
}

export const teacherLiveRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  // 04 §2：P0 每 5 秒轮询；返回看板快照（状态由服务端按 04 §2.3 计算）。
  app.get('/teacher/classes/:classId/live', async (request) => {
    const auth = await requireTeacher(db, request);
    const classId = uuidParam((request.params as ClassIdParams).classId, '班级');
    const assignmentId = assignmentQuery((request.query as LiveQuery).assignmentId);
    const snapshot = await buildLiveSnapshot(db, config, auth, classId, assignmentId);
    contract.validate('LiveSnapshot', snapshot);
    return snapshot;
  });

  // 04 §3 / 08 §4：口径以 08 §4 为准；样本 <10 只给人数。
  app.get('/teacher/classes/:classId/metrics', async (request) => {
    const auth = await requireTeacher(db, request);
    const classId = uuidParam((request.params as ClassIdParams).classId, '班级');
    const assignmentId = assignmentQuery((request.query as LiveQuery).assignmentId);
    const metrics = await buildClassMetrics(db, auth, classId, assignmentId);
    contract.validate('MetricsView', metrics);
    return metrics;
  });
};
