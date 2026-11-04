import type { FastifyPluginAsync } from 'fastify';

import { maskIp, sha256Hex } from '../auth/crypto.ts';
import { buildMe } from '../auth/me.ts';
import { clearSessionCookie, requireAuth, revokeSession, setSessionCookie } from '../auth/session.ts';
import { studentLogin } from '../auth/student-login.ts';
import { teacherLogin } from '../auth/teacher-login.ts';
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

interface TeacherLoginBody {
  username: string;
  password: string;
  totp?: string;
}

// 一个班约 60 人同时登录，留出输错学号重试的余量。
export const LOGIN_MAX_PER_MINUTE = 120;

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, { db, config, contract }) => {
  // 生产/测试强制 Secure；开发环境放开，允许 http://内网 IP 给学生手机演示（#67-1）。
  const secureCookie = config.env !== 'development';
  // 同 IP 120 次/分。05 §7 原写 10 次/分，但校园网出口共用一个 IP，一个班（≈60 人）同时登录时第 11 个人起全部 429；
  // 这里只防整段脚本式爆破，不防单个学号被猜。同邀请码失败锁定：未实现，策略需产品确认（见复审报告 P1-5）。
  app.post(
    '/auth/student/login',
    { config: { rateLimit: { max: LOGIN_MAX_PER_MINUTE, timeWindow: '1 minute' } } },
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
      setSessionCookie(reply, session.sessionId, session.expiresAt, { secure: secureCookie });

      const me = await buildMe(db, { userId: session.userId, role: 'student', sessionId: session.sessionId });
      contract.validate('Me', me);
      return me;
    },
  );

  // 教师登录用户少且没有共用出口问题，保持 10 次/分/IP（05 §7）。
  app.post(
    '/auth/teacher/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      contract.validateRequest('/auth/teacher/login', 'post', request.body);
      const body = request.body as TeacherLoginBody;

      const session = await teacherLogin(db, {
        username: body.username,
        password: body.password,
        ipMasked: maskIp(request.ip),
      });
      setSessionCookie(reply, session.sessionId, session.expiresAt, { secure: secureCookie });

      const me = await buildMe(db, { userId: session.userId, role: session.role, sessionId: session.sessionId });
      contract.validate('Me', me);
      return me;
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const auth = await requireAuth(db, request);
    await revokeSession(db, auth.sessionId);
    clearSessionCookie(reply, { secure: secureCookie });
    return reply.status(204).send();
  });

  app.get('/me', async (request) => {
    const auth = await requireAuth(db, request);
    const me = await buildMe(db, auth);
    contract.validate('Me', me);
    return me;
  });
};
