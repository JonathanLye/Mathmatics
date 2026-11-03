import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { requireTeacher, uuidParam, loadTeacherAttempt } from '../../services/teacher/auth.ts';
import { loadAttemptDetail, loadAttemptEvents } from '../../services/teacher/attempts.ts';
import { nudgeStudent, unlockForTeacher } from '../../services/teacher/interventions.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface AttemptIdParams {
  attemptId: string;
}
interface EventsQuery {
  afterSeq?: string;
  limit?: string;
}
interface UnlockBody {
  grantH4?: string;
}
interface NudgeBody {
  text: string;
}

function intQuery(raw: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError('VALIDATION_FAILED', 422, `${name} 不合法`);
  }
  return value;
}

export const teacherAttemptRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  app.get('/teacher/attempts/:attemptId', async (request) => {
    const auth = await requireTeacher(db, request);
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    const detail = await loadAttemptDetail(db, config, auth, attemptId);
    contract.validate('AttemptDetail', detail);
    return detail;
  });

  // 08 §2/§6：回放/时间线用；按 seq 分页，不返回 user_id。
  app.get('/teacher/attempts/:attemptId/events', async (request) => {
    const auth = await requireTeacher(db, request);
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    const query = request.query as EventsQuery;
    const afterSeq = intQuery(query.afterSeq, 0, 'afterSeq', 0, Number.MAX_SAFE_INTEGER);
    const limit = intQuery(query.limit, 500, 'limit', 1, 1000);
    return loadAttemptEvents(db, auth, attemptId, afterSeq, limit);
  });

  // 04 §6 / 11 §5.2：解锁复用 B 的 unlockAttempt；grantH4 尚未实现（#31 交接项）。
  app.post('/teacher/attempts/:attemptId/unlock', async (request) => {
    const auth = await requireTeacher(db, request);
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    const body = (request.body ?? {}) as UnlockBody;
    await unlockForTeacher(db, auth, attemptId, body.grantH4);
    const detail = await loadAttemptDetail(db, config, auth, attemptId);
    contract.validate('AttemptDetail', detail);
    return detail;
  });

  // 04 §6：发一句话 ≤200 字，过闸门。
  app.post('/teacher/attempts/:attemptId/nudge', async (request) => {
    const auth = await requireTeacher(db, request);
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    contract.validateRequest('/teacher/attempts/{attemptId}/nudge', 'post', request.body);
    const body = request.body as NudgeBody;
    return nudgeStudent(db, auth, attemptId, body.text);
  });
};
