import { createReadStream } from 'node:fs';

import type { FastifyPluginAsync } from 'fastify';

import {
  contentTypeFor,
  createExport,
  exportFile,
  getExport,
  parseCreateExport,
  type ExportJobDto,
} from '../../services/teacher/exports.ts';
import { assertClassTeacher, requireTeacher, uuidParam } from '../../services/teacher/auth.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface ExportIdParams {
  exportId: string;
}

export const teacherExportRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, contract }) => {
  // 06 §3 / 04 §9：创建匿名导出；实名导出进入 pending_approval（管理员审批后才会生成）。
  app.post('/teacher/exports', async (request, reply) => {
    const auth = await requireTeacher(db, request);
    contract.validateRequest('/teacher/exports', 'post', request.body);
    const input = parseCreateExport(request.body);
    await assertClassTeacher(db, auth, input.classId);
    const job = await createExport(db, auth, input, request.log);
    contract.validate('ExportJob', job);
    return reply.code(202).send(job);
  });

  app.get('/teacher/exports/:exportId', async (request) => {
    const auth = await requireTeacher(db, request);
    const { exportId } = request.params as ExportIdParams;
    const job = await getExport(db, auth, uuidParam(exportId, '导出任务'));
    contract.validate('ExportJob', job);
    return job;
  });

  // 契约里 ExportJob.url 是不透明下载地址；同源、教师 Cookie 鉴权。
  app.get('/teacher/exports/:exportId/download', { logLevel: 'warn' }, async (request, reply) => {
    const auth = await requireTeacher(db, request);
    const { exportId } = request.params as ExportIdParams;
    const id = uuidParam(exportId, '导出任务');
    const { file, format, fileKey } = await exportFile(db, auth, id);
    await db.query(
      `insert into app.audit_log (actor_id, action, target, detail) values ($1, 'export_download', $2, $3::jsonb)`,
      [auth.userId, id, JSON.stringify({ format })],
    );
    reply.header('content-type', contentTypeFor(format));
    reply.header('content-disposition', `attachment; filename="${fileKey}"`);
    reply.header('cache-control', 'private, no-store');
    return reply.send(createReadStream(file));
  });
};

export type { ExportJobDto };
