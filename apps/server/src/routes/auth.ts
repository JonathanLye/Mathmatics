import type { FastifyPluginAsync } from 'fastify';

import { setAgeBandOnce, type AgeBand } from '../auth/age-band.ts';
import { maskIp, normalizeStudentNo, sha256Hex, studentNoHash } from '../auth/crypto.ts';
import { createLoginThrottle } from '../auth/login-throttle.ts';
import { buildMe } from '../auth/me.ts';
import { clearSessionCookie, requireAuth, revokeSession, setSessionCookie } from '../auth/session.ts';
import { studentLogin } from '../auth/student-login.ts';
import { INVALID_CREDENTIALS, teacherLogin } from '../auth/teacher-login.ts';
import type { AppConfig } from '../config.ts';
import type { ContractValidator } from '../contract.ts';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';

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
  // #61：登录失败锁定。单实例内存实现；多实例部署时各实例独立计数（05 §7 已注明）。
  // 学生按 (IP, 学号哈希) 计、不按邀请码整体锁（一个班共用一个出口 IP，按邀请码锁会锁全班）；
  // 教师按账号计，锁定期间返回与密码错误相同的 401 文案。
  const loginThrottle = createLoginThrottle();
  // 同 IP 120 次/分。05 §7 原写 10 次/分，但校园网出口共用一个 IP，一个班（≈60 人）同时登录时第 11 个人起全部 429；
  // 这里只防整段脚本式爆破，不防单个学号被猜。同邀请码失败锁定：未实现，策略需产品确认（见复审报告 P1-5）。
  app.post(
    '/auth/student/login',
    { config: { rateLimit: { max: LOGIN_MAX_PER_MINUTE, timeWindow: '1 minute' } } },
    async (request, reply) => {
      contract.validateRequest('/auth/student/login', 'post', request.body);
      const body = request.body as StudentLoginBody;
      const userAgent = request.headers['user-agent'];
      // #61：按 (IP, 学号哈希) 统计凭证失败，5 次锁 10 分钟；不按邀请码整体锁（会锁全班）。
      const throttleKey = `student:${request.ip}|${studentNoHash(config.studentNoPepper, normalizeStudentNo(body.studentNo))}`;
      const locked = loginThrottle.check(throttleKey);
      if (locked.locked) {
        throw new AppError('RATE_LIMITED', 429, '登录尝试过多，请稍后再试', { retryAfterSec: locked.retryAfterSec });
      }

      let session;
      try {
        session = await studentLogin(db, config, {
          inviteCode: body.inviteCode,
          studentNo: body.studentNo,
          deviceId: body.deviceId,
          ip: maskIp(request.ip),
          uaHash: userAgent === undefined ? null : sha256Hex(userAgent),
        });
      } catch (error) {
        // 只统计凭证失败（邀请码错/学号不在名单）；网络等其它错误不计。
        if (error instanceof AppError && (error.code === 'INVALID_INVITE' || error.code === 'NOT_IN_ROSTER')) {
          loginThrottle.recordFailure(throttleKey);
        }
        throw error;
      }
      loginThrottle.reset(throttleKey);
      setSessionCookie(reply, session.sessionId, session.expiresAt, { secure: secureCookie });

      const me = await buildMe(db, { userId: session.userId, role: 'student', sessionId: session.sessionId });
      contract.validate('Me', me);
      return me;
    },
  );

  // 13 §4：学生自选年龄段（名单未带时）。<14 也记录并返回 Me，但写接口守卫会 403 AGE_RESTRICTED。
  app.post('/auth/student/age-band', async (request) => {
    const auth = await requireAuth(db, request);
    if (auth.role !== 'student') throw new AppError('FORBIDDEN', 403, '只有学生需要选择年龄段');
    contract.validateRequest('/auth/student/age-band', 'post', request.body);
    const body = request.body as { ageBand: AgeBand };
    await setAgeBandOnce(db, auth.userId, body.ageBand);
    const me = await buildMe(db, auth);
    contract.validate('Me', me);
    return me;
  });

  // 教师登录用户少且没有共用出口问题，保持 10 次/分/IP（05 §7）。
  app.post(
    '/auth/teacher/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      contract.validateRequest('/auth/teacher/login', 'post', request.body);
      const body = request.body as TeacherLoginBody;
      const teacherKey = `teacher:${body.username.trim().toLowerCase()}`;
      // 锁定期间返回与密码错误相同的 401 文案（不泄露账号被锁）。
      if (loginThrottle.check(teacherKey).locked) {
        throw new AppError('UNAUTHORIZED', 401, INVALID_CREDENTIALS);
      }

      let session;
      try {
        session = await teacherLogin(db, {
          username: body.username,
          password: body.password,
          ...(body.totp === undefined ? {} : { totp: body.totp }),
          piiKey: config.piiKey,
          ipMasked: maskIp(request.ip),
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'UNAUTHORIZED') loginThrottle.recordFailure(teacherKey);
        throw error;
      }
      loginThrottle.reset(teacherKey);
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
