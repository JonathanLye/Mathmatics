import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../auth/session.ts';
import { AppError } from '../errors.ts';
import { ingestBatch } from '../events/ingest.ts';

import type { AuthRouteOptions } from './auth.ts';

// 06 §1 / openapi /events/batch：每批最多 100 条、256KB；按事件 id 去重；只收客户端类型。
const MAX_EVENTS = 100;
const MAX_BODY_BYTES = 256 * 1024;

export const eventRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db }) => {
  app.post('/events/batch', { bodyLimit: MAX_BODY_BYTES }, async (request) => {
    const auth = await requireAuth(db, request);
    const body = request.body as { events?: unknown } | undefined;
    const events = body?.events;
    if (!Array.isArray(events)) throw new AppError('VALIDATION_FAILED', 422, '需要 events 数组');
    if (events.length > MAX_EVENTS) throw new AppError('VALIDATION_FAILED', 422, `每批最多 ${MAX_EVENTS} 条`);
    return ingestBatch(db, { userId: auth.userId, role: auth.role }, events);
  });
};
