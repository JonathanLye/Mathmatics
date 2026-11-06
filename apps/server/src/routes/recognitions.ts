import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';

import { requireStudentConsent } from '../auth/consent.ts';
import { bySession, requireAuth } from '../auth/session.ts';
import { AppError } from '../errors.ts';
import { createRecognitionService } from '../recognition/service.ts';
import type { ModelGateway } from '../ai/gateway.ts';

import type { AuthRouteOptions } from './auth.ts';

// 06 §4.1 / openapi /recognitions/*：手写识别在"写完这一行"时调用一次，不做实时识别。
// ink 字段 ≤ 256KB（base64 字符数）；JSON 外壳留 8KB 余量。
const INK_BODY_LIMIT = 264 * 1024;
// 03 §3.3：前端压到长边 ≤ 2000px、≤ 2MB。
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export interface RecognitionRouteOptions extends AuthRouteOptions {
  gateway: ModelGateway;
}

export const recognitionRoutes: FastifyPluginAsync<RecognitionRouteOptions> = async (app, { db, config, contract, gateway }) => {
  const svc = createRecognitionService({ db, gateway, config, contract, logger: app.log });
  // 每会话每分钟的请求数上限只挡失控重试；每生每日上限与并发由服务自己控制（config.recognition）。
  const limited = { max: 60, timeWindow: '1 minute', keyGenerator: bySession };
  const param = (request: { params: unknown }, name: string): string => (request.params as Record<string, string>)[name] ?? '';

  app.post(
    '/recognitions/ink',
    {
      bodyLimit: INK_BODY_LIMIT,
      // 共享错误处理器把框架的 413 映射成 BAD_REQUEST（events.test.ts 固定了这一点）；契约要求本接口返回 PAYLOAD_TOO_LARGE，
      // 所以在解析请求体之前按 Content-Length 先拒绝。无 Content-Length 的分块请求仍由框架兜底。
      onRequest: async (request) => {
        if (Number(request.headers['content-length'] ?? 0) > INK_BODY_LIMIT) {
          throw new AppError('PAYLOAD_TOO_LARGE', 413, '笔迹数据太大');
        }
      },
      preHandler: [requireStudentConsent(db)],
      config: { rateLimit: limited },
    },
    async (request) => {
      const auth = await requireAuth(db, request);
      contract.validateRequest('/recognitions/ink', 'post', request.body);
      const body = request.body as { attemptId: string; draftId: string; target: string; ink: string };
      if (body.ink.length > 256 * 1024) throw new AppError('PAYLOAD_TOO_LARGE', 413, '笔迹数据太大');
      return svc.recognizeInk(auth.userId, body);
    },
  );

  // 照片：multipart，图片 ≤ 2MB（前端压缩后上传）；字段 attemptId/draftId/target/source/image。
  await app.register(multipart, { limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 8, parts: 12 } });
  const TARGETS = new Set(['def', 'frame', 'line_statement', 'line_justification', 'selfcheck', 'summary', 'help_text']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.post(
    '/recognitions/photo',
    {
      onRequest: async (request) => {
        if (Number(request.headers['content-length'] ?? 0) > PHOTO_MAX_BYTES + 64 * 1024) {
          throw new AppError('PAYLOAD_TOO_LARGE', 413, '图片太大，请靠近一点重拍或用键盘');
        }
      },
      preHandler: [requireStudentConsent(db)],
      config: { rateLimit: limited },
    },
    async (request) => {
      const auth = await requireAuth(db, request);
      if (!request.isMultipart()) throw new AppError('VALIDATION_FAILED', 422, '需要 multipart/form-data');
      const fields: Record<string, string> = {};
      let image: Buffer | null = null;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            if (part.fieldname === 'image' && image === null) image = await part.toBuffer();
            else await part.toBuffer(); // 多余的文件：读掉丢弃
          } else if (typeof part.value === 'string') {
            fields[part.fieldname] = part.value;
          }
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError('PAYLOAD_TOO_LARGE', 413, '图片太大，请靠近一点重拍或用键盘');
        throw new AppError('VALIDATION_FAILED', 422, '上传内容无法解析');
      }
      const { attemptId, draftId, target } = fields;
      if (!attemptId || !UUID.test(attemptId) || !draftId || !UUID.test(draftId) || !target || !TARGETS.has(target) || image === null) {
        throw new AppError('VALIDATION_FAILED', 422, '参数不合法：需要 attemptId、draftId、target、image');
      }
      const source = fields.source === 'camera' ? 'camera' : fields.source === 'album' || fields.source === undefined ? 'album' : null;
      if (source === null) throw new AppError('VALIDATION_FAILED', 422, 'source 只能是 camera 或 album');
      return svc.recognizePhoto(auth.userId, { attemptId, draftId, target, source, image });
    },
  );

  app.post(
    '/recognitions/:recogId/confirm',
    { preHandler: [requireStudentConsent(db)], config: { rateLimit: limited } },
    async (request) => {
      const auth = await requireAuth(db, request);
      contract.validateRequest('/recognitions/{recogId}/confirm', 'post', request.body);
      const body = request.body as { text: string; lines?: string[] };
      return svc.confirm(auth.userId, param(request, 'recogId'), body);
    },
  );
};
