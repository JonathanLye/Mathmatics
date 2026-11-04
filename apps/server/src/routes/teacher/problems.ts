import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { requireTeacher } from '../../services/teacher/auth.ts';
import { getProblemVersion, listProblems, reviewProblem, type ReviewInput } from '../../services/teacher/problems.ts';

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
const DECISIONS = ['approve', 'return', 'edit'] as const;

// openapi 的 review requestBody 内联引用了 ./problem-package.schema.json（AJV 无法直接 resolve 外部文件），
// 这里按同一声明手写校验，错误形状与 contract.validateRequest 一致（422 VALIDATION_FAILED）。
function validateReviewBody(body: unknown): void {
  const input = (body ?? {}) as Record<string, unknown>;
  const errors: Array<Record<string, unknown>> = [];
  if (!DECISIONS.includes(input.decision as (typeof DECISIONS)[number])) {
    errors.push({ instancePath: '/decision', message: 'decision 必须是 approve/return/edit' });
  }
  if (input.comments !== undefined && typeof input.comments !== 'string') {
    errors.push({ instancePath: '/comments', message: 'comments 必须是字符串' });
  }
  if (input.minutes !== undefined && (!Number.isInteger(input.minutes) || Number(input.minutes) < 0)) {
    errors.push({ instancePath: '/minutes', message: 'minutes 必须是非负整数' });
  }
  if (input.edited !== undefined && (typeof input.edited !== 'object' || input.edited === null)) {
    errors.push({ instancePath: '/edited', message: 'edited 必须是对象' });
  }
  if (input.decision === 'edit' && input.edited === undefined) {
    errors.push({ instancePath: '/edited', message: 'edit 需要 edited 题目包' });
  }
  if (errors.length > 0) throw new AppError('VALIDATION_FAILED', 422, '参数不合法', { errors });
}

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

  // 04 §8.2 审核结论：approve 要求 auto_checks 四项全绿（由导入 S8 写入）；return 记录退回。
  app.post('/teacher/problems/:problemId/versions/:version/review', async (request) => {
    const auth = await requireTeacher(db, request);
    const params = request.params as ProblemVersionParams;
    const version = Number(params.version);
    if (!Number.isInteger(version) || version < 1) throw new AppError('VALIDATION_FAILED', 422, 'version 不合法');
    validateReviewBody(request.body);
    const item = await reviewProblem(db, auth.userId, params.problemId, version, request.body as ReviewInput);
    contract.validate('ProblemListItem', item);
    return item;
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
