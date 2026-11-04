import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { assertClassTeacher, requireTeacher, uuidParam } from '../../services/teacher/auth.ts';
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

  // 06 §6 / 04 §2.2（P1）：班级看板 SSE。事件 row / flag / ping；教师 Cookie 鉴权（同源）。
  // 连接时先推当前全部行，之后 1s diff 变化行；浏览器断线自动重连，前端保留 5s 轮询兜底。
  app.get('/teacher/classes/:classId/stream', { logLevel: 'warn' }, async (request, reply) => {
    const auth = await requireTeacher(db, request);
    const classId = uuidParam((request.params as ClassIdParams).classId, '班级');
    const assignmentId = assignmentQuery((request.query as LiveQuery).assignmentId);
    await assertClassTeacher(db, auth, classId);

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    let closed = false;
    let busy = false;
    let poll: NodeJS.Timeout | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let lastWarn = 0;
    const last = new Map<string, string>();
    const write = (chunk: string): boolean => {
      if (closed || reply.raw.destroyed) return false;
      const ok = reply.raw.write(chunk);
      if (ok === false) {
        // 慢客户端/缓冲满：主动断开，交给浏览器重连 + 轮询兜底，避免服务端累积。
        cleanup();
        reply.raw.end();
        return false;
      }
      return true;
    };
    const pump = async (): Promise<void> => {
      if (closed || busy) return;
      busy = true;
      try {
        const snapshot = await buildLiveSnapshot(db, config, auth, classId, assignmentId);
        for (const row of snapshot.rows) {
          if (closed) return;
          const json = JSON.stringify(row);
          const previous = last.get(row.anonCode);
          if (previous === json) continue;
          last.set(row.anonCode, json);
          if (!write(`event: row\ndata: ${json}\n\n`)) return;
          if (previous !== undefined) {
            const before = JSON.parse(previous) as { flags?: string[] };
            const added = row.flags.filter((flag) => !(before.flags ?? []).includes(flag));
            for (const type of added) {
              if (
                !write(
                  `event: flag\ndata: ${JSON.stringify({ type, attemptId: row.attemptId, anonCode: row.anonCode, at: snapshot.at })}\n\n`,
                )
              ) {
                return;
              }
            }
          }
        }
      } catch (error) {
        // DB 抖动：连接保持、下一轮重试；日志限频（10s 最多一次）。
        const now = Date.now();
        if (now - lastWarn > 10_000) {
          lastWarn = now;
          request.log.warn({ err: error, classId }, 'class stream pump failed');
        }
      } finally {
        busy = false;
      }
    };

    // 先注册清理（首帧期间客户端也可能断开），再开始 pump / interval。
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (poll !== undefined) clearInterval(poll);
      if (heartbeat !== undefined) clearInterval(heartbeat);
      poll = undefined;
      heartbeat = undefined;
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    await pump();
    if (closed || reply.raw.destroyed) {
      cleanup();
      return;
    }
    const pingMs =
      process.env.NODE_ENV === 'test' ? Number(process.env.TEACHER_SSE_PING_MS ?? 20_000) : 20_000;
    poll = setInterval(() => {
      void pump();
    }, 1000);
    heartbeat = setInterval(() => {
      if (!write('event: ping\ndata: {}\n\n')) cleanup();
    }, Number.isFinite(pingMs) && pingMs > 0 ? pingMs : 20_000);
  });
};
