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

export interface RecognitionRouteOptions extends AuthRouteOptions {
  gateway: ModelGateway;
}

export const recognitionRoutes: FastifyPluginAsync<RecognitionRouteOptions> = async (app, { db, config, contract, gateway }) => {
  const svc = createRecognitionService({ db, gateway, config, contract });
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
