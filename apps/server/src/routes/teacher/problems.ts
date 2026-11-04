import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { requireTeacher } from '../../services/teacher/auth.ts';
import { getProblemVersion, listProblems } from '../../services/teacher/problems.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface ProblemListQuery {
  status?: string;
  chapter?: string;
}
interface ProblemVersionParams {
  problemId: string;
  version: string;
}

const STATUSES = ['draft', 'pending', 'returned', 'published', 'retired'] as const;

export const teacherProblemRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  // 04 §8 审核屏：题库列表（含审核状态）；status / chapter 过滤。
  app.get('/teacher/problems', async (request) => {
    await requireTeacher(db, request);
    const query = request.query as ProblemListQuery;
    if (query.status !== undefined && !STATUSES.includes(query.status as (typeof STATUSES)[number])) {
      throw new AppError('VALIDATION_FAILED', 422, 'status 不合法');
    }
    const items = await listProblems(db, { status: query.status, chapter: query.chapter });
    for (const item of items) contract.validate('ProblemListItem', item);
    return items;
  });

  // 完整题目包（含 secret）；仅教师/审核角色，读操作记 audit_log。
  app.get('/teacher/problems/:problemId/versions/:version', async (request) => {
    const auth = await requireTeacher(db, request);
    const params = request.params as ProblemVersionParams;
    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) throw new AppError('VALIDATION_FAILED', 422, 'version 不合法');
    return getProblemVersion(db, auth.userId, params.problemId, version);
  });
};
