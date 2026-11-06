import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { requireTeacher } from '../../services/teacher/auth.ts';
import { getProblemVersion, listProblemsPage, reviewProblem, setProblemHidden, type ReviewInput } from '../../services/teacher/problems.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface ProblemListQuery {
  status?: string;
  chapter?: string;
  q?: string;
  reviewSource?: string;
  kind?: string;
  limit?: string;
  cursor?: string;
}
interface ProblemVersionParams {
  problemId: string;
  version: string;
}

const STATUSES = ['draft', 'pending', 'returned', 'published', 'retired'] as const;
const REVIEW_SOURCES = ['teacher', 'auto'] as const;
const KINDS = ['main', 'transfer'] as const;
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
  app.get('/teacher/problems', async (request, reply) => {
    await requireTeacher(db, request);
    const query = request.query as ProblemListQuery;
    if (query.status !== undefined && !STATUSES.includes(query.status as (typeof STATUSES)[number])) {
      throw new AppError('VALIDATION_FAILED', 422, 'status 不合法');
    }
    let limit: number | undefined;
    if (query.limit !== undefined && query.limit !== '') {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('VALIDATION_FAILED', 422, 'limit 需为 1–100');
    }
    if (query.reviewSource !== undefined && !REVIEW_SOURCES.includes(query.reviewSource as (typeof REVIEW_SOURCES)[number])) {
      throw new AppError('VALIDATION_FAILED', 422, 'reviewSource 不合法');
    }
    if (query.kind !== undefined && !KINDS.includes(query.kind as (typeof KINDS)[number])) {
      throw new AppError('VALIDATION_FAILED', 422, 'kind 不合法');
    }
    if (query.q !== undefined && query.q.length > 60) throw new AppError('VALIDATION_FAILED', 422, 'q 太长');
    const page = await listProblemsPage(db, {
      status: query.status,
      chapter: query.chapter,
      q: query.q,
      reviewSource: query.reviewSource,
      kind: query.kind,
      limit,
      cursor: query.cursor === '' ? undefined : query.cursor,
    });
    for (const item of page.items) contract.validate('ProblemListItem', item);
    // 响应体仍是数组（教师端现有调用不变）；下一页游标放响应头。
    if (page.nextCursor !== null) reply.header('x-next-cursor', page.nextCursor);
    return page.items;
  });

  // 下架 / 恢复上架：设置或清除 hidden_at。下架的题不再进学生的路径与练习区；已有作答与老师的布置不受影响。
  app.patch('/teacher/problems/:problemId/visibility', async (request) => {
    const auth = await requireTeacher(db, request);
    const params = request.params as { problemId: string };
    const body = (request.body ?? {}) as { hidden?: unknown };
    if (typeof body.hidden !== 'boolean') throw new AppError('VALIDATION_FAILED', 422, 'hidden 必须是布尔值');
    const result = await setProblemHidden(db, auth.userId, params.problemId, body.hidden);
    contract.validate('ProblemVisibility', result);
    return result;
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
