import type { FastifyPluginAsync } from 'fastify';

import { AppError } from '../../errors.ts';
import { requireTeacher, uuidParam, loadTeacherAttempt } from '../../services/teacher/auth.ts';
import { loadAttemptDetail, loadAttemptEvents, reclassifyLine, type ReclassifyInput } from '../../services/teacher/attempts.ts';
import { nudgeStudent, unlockForTeacher } from '../../services/teacher/interventions.ts';
import {
  appendMirrorEvent,
  issueMirrorToken,
  loadAttemptMeta,
  loadMirrorState,
  verifyMirrorToken,
} from '../../services/teacher/mirror.ts';

import type { AuthRouteOptions } from '../auth.ts';

interface AttemptIdParams {
  attemptId: string;
}
interface EventsQuery {
  afterSeq?: string;
  limit?: string;
}
interface StreamQuery {
  token?: string;
}

// 同一作答同时最多 2 条镜像 SSE（教师本人 + 一个备用）；防止 token 5 分钟内被重放刷连接（A 复审 P2-2）。
const MAX_MIRROR_STREAMS = 2;
// P0：每连接 1s 查一次 state_version（单班 ≤60 人、镜像连接 ≤2/作答）；量大后换 LISTEN/NOTIFY 或复用 class 快照。
const MIRROR_POLL_MS = 1000;
const mirrorStreams = new Map<string, number>();
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

  // 04 §4：教师改判一行归类（audit_log；不改学生已见内容）。
  app.post('/teacher/attempts/:attemptId/lines/:lineId/reclassify', async (request) => {
    const auth = await requireTeacher(db, request);
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    const lineId = uuidParam((request.params as { lineId: string }).lineId, '证明行');
    contract.validateRequest('/teacher/attempts/{attemptId}/lines/{lineId}/reclassify', 'post', request.body);
    return reclassifyLine(db, auth, attemptId, lineId, request.body as ReclassifyInput);
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

  // 04 §5.1 / 06 §6：教师端 iframe 用 5 分钟只读令牌打开镜像页。
  app.post('/teacher/attempts/:attemptId/mirror-token', async (request) => {
    const auth = await requireTeacher(db, request);
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    await loadTeacherAttempt(db, auth, attemptId);
    return issueMirrorToken(attemptId, auth.userId, config.sessionSecret);
  });

  // 06 §6：SSE，event: state（学生视图 AttemptState）/ ping（20s）；教师 Cookie 或 mirrorToken 鉴权。
  app.get('/teacher/attempts/:attemptId/stream', { logLevel: 'warn' }, async (request, reply) => {
    const attemptId = uuidParam((request.params as AttemptIdParams).attemptId, '作答');
    const token = (request.query as StreamQuery).token;
    const viaToken = typeof token === 'string' && token !== '';
    let teacherId: string;
    if (viaToken) {
      const payload = verifyMirrorToken(token, attemptId, config.sessionSecret);
      if (payload === null) throw new AppError('UNAUTHORIZED', 401, '镜像令牌无效或已过期');
      teacherId = payload.u;
    } else {
      const auth = await requireTeacher(db, request);
      await loadTeacherAttempt(db, auth, attemptId);
      teacherId = auth.userId;
    }

    const meta = await loadAttemptMeta(db, attemptId);

    const active = mirrorStreams.get(attemptId) ?? 0;
    if (active >= MAX_MIRROR_STREAMS) {
      throw new AppError('RATE_LIMITED', 429, '该作答的镜像连接过多，请稍后再试');
    }
    mirrorStreams.set(attemptId, active + 1);

    try {
      await appendMirrorEvent(db, meta, teacherId, 'open');
    } catch (error) {
      const left = (mirrorStreams.get(attemptId) ?? 1) - 1;
      if (left <= 0) mirrorStreams.delete(attemptId);
      else mirrorStreams.set(attemptId, left);
      throw error;
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      // 沙箱 iframe 是 opaque origin（allow-scripts 无 allow-same-origin）：token 路径无 Cookie，
      // 仅凭 token 鉴权，允许跨源读取（A 复审 P1-2 方案①；EventSource 默认 withCredentials=false）。
      ...(viaToken ? { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } : {}),
    });
    let closed = false;
    let version = meta.state_version;
    let mutex = false;
    const write = (chunk: string): void => {
      if (!closed) reply.raw.write(chunk);
    };
    const sendState = async (): Promise<void> => {
      const view = await loadMirrorState(db, attemptId);
      if (closed) return;
      write(`id: ${version}\nevent: state\ndata: ${JSON.stringify(view)}\n\n`);
    };

    const lastEventId = Number(request.headers['last-event-id']);
    try {
      if (!Number.isInteger(lastEventId) || lastEventId < version) await sendState();
    } catch {
      reply.raw.end();
      return;
    }

    // 1s 轮询 state_version；变化才推送（P0 数据量小，够用；SSE 只推不拉学生端状态）。
    const poll = setInterval(() => {
      if (closed || mutex) return;
      mutex = true;
      void (async () => {
        try {
          const row = (
            await db.query<{ state_version: number }>(`select state_version from app.attempts where id = $1`, [attemptId])
          ).rows[0];
          if (row !== undefined && Number(row.state_version) !== version) {
            version = Number(row.state_version);
            await sendState();
          }
        } catch {
          // 连接已断或 DB 抖动：下一轮重试
        } finally {
          mutex = false;
        }
      })();
    }, MIRROR_POLL_MS);
    const heartbeat = setInterval(() => write('event: ping\ndata: {}\n\n'), 20_000);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      const left = (mirrorStreams.get(attemptId) ?? 1) - 1;
      if (left <= 0) mirrorStreams.delete(attemptId);
      else mirrorStreams.set(attemptId, left);
      void appendMirrorEvent(db, meta, teacherId, 'close').catch(() => undefined);
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
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
