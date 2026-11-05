import type { FastifyPluginAsync } from 'fastify';

import { getAgeBand } from '../auth/age-band.ts';
import { bySession, requireAuth } from '../auth/session.ts';
import { AppError } from '../errors.ts';
import { ingestBatch } from '../events/ingest.ts';

import type { AuthRouteOptions } from './auth.ts';

// 06 §1 / openapi /events/batch：每批最多 100 条、256KB；按事件 id 去重；只收客户端类型。
const MAX_EVENTS = 100;
const MAX_BODY_BYTES = 256 * 1024;

// 客户端约每 5–10 秒攒一批，正常 ≤ 12 批/分；默认上限 120（config.rateLimits.events），只挡失控的重试循环。按会话计，校园共用 IP 下互不影响。
export const eventRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config }) => {
  app.post(
    '/events/batch',
    { bodyLimit: MAX_BODY_BYTES, config: { rateLimit: { max: config.rateLimits.events, timeWindow: '1 minute', keyGenerator: bySession } } },
    async (request) => {
    const auth = await requireAuth(db, request);
    // 13 §4：<14 不开通，连过程监测事件也不采集（数据最小化）。
    if (auth.role === 'student' && (await getAgeBand(db, auth.userId)) === 'lt14') {
      throw new AppError('AGE_RESTRICTED', 403, '本服务暂未向 14 岁以下学生开放');
    }
    const body = request.body as { events?: unknown } | undefined;
    const events = body?.events;
    if (!Array.isArray(events)) throw new AppError('VALIDATION_FAILED', 422, '需要 events 数组');
    if (events.length > MAX_EVENTS) throw new AppError('VALIDATION_FAILED', 422, `每批最多 ${MAX_EVENTS} 条`);
    return ingestBatch(db, { userId: auth.userId, role: auth.role }, events);
    },
  );
};
