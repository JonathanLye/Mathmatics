import type { FastifyPluginAsync } from 'fastify';

import { maskIp, sha256Hex } from '../auth/crypto.ts';
import { buildMe } from '../auth/me.ts';
import { clearSessionCookie, requireAuth, revokeSession, setSessionCookie } from '../auth/session.ts';
import { studentLogin } from '../auth/student-login.ts';
import type { AppConfig } from '../config.ts';
import type { ContractValidator } from '../contract.ts';
import type { Db } from '../db/index.ts';

export interface AuthRouteOptions {
  db: Db;
  config: AppConfig;
  contract: ContractValidator;
}

interface StudentLoginBody {
  inviteCode: string;
  studentNo: string;
  deviceId: string;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  // 10 次/分/IP（05 §7）。同邀请码失败 5 次锁 10 分钟：未实现，见后续 issue。
  app.post(
    '/auth/student/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      contract.validateRequest('/auth/student/login', 'post', request.body);
      const body = request.body as StudentLoginBody;
      const userAgent = request.headers['user-agent'];

      const session = await studentLogin(db, config, {
        inviteCode: body.inviteCode,
        studentNo: body.studentNo,
        deviceId: body.deviceId,
        ip: maskIp(request.ip),
        uaHash: userAgent === undefined ? null : sha256Hex(userAgent),
      });
      setSessionCookie(reply, session.sessionId, session.expiresAt);

      const me = await buildMe(db, { userId: session.userId, role: 'student', sessionId: session.sessionId });
      contract.validate('Me', me);
      return me;
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const auth = await requireAuth(db, request);
    await revokeSession(db, auth.sessionId);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.get('/me', async (request) => {
    const auth = await requireAuth(db, request);
    const me = await buildMe(db, auth);
    contract.validate('Me', me);
    return me;
  });
};
