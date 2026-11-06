import type { FastifyPluginAsync } from 'fastify';

import { setAgeBandOnce, type AgeBand } from '../auth/age-band.ts';
import { maskIp, normalizeStudentNo, sha256Hex, studentNoHash } from '../auth/crypto.ts';
import { changeTeacherPassword, setStudentPassword, type PasswordChangeInput } from '../auth/account-password.ts';
import { createLoginThrottle } from '../auth/login-throttle.ts';
import { buildMe } from '../auth/me.ts';
import {
  bySession,
  clearSessionCookie,
  LEGACY_SESSION_COOKIE,
  requireApp,
  requireAuth,
  requireStudent,
  revokeSession,
  revokeUserSessions,
  sessionAppFor,
  setSessionCookie,
} from '../auth/session.ts';
import { studentLogin } from '../auth/student-login.ts';
import { INVALID_CREDENTIALS, teacherLogin } from '../auth/teacher-login.ts';
import type { AppConfig } from '../config.ts';
import type { ContractValidator } from '../contract.ts';
import type { Db } from '../db/index.ts';
import { AppError } from '../errors.ts';
import { createIdempotency } from '../idempotency.ts';

export interface AuthRouteOptions {
  db: Db;
  config: AppConfig;
  contract: ContractValidator;
}

interface StudentLoginBody {
  inviteCode?: string;
  studentNo: string;
  password?: string;
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
  // 改密码时校验“当前密码”的失败也走同一套锁定（按用户计）：偷到 Cookie 的人不能把改密接口当密码校验器无限试。
  const passwordThrottle = createLoginThrottle();
  const idempotency = createIdempotency(db);
  // 密码类写接口：按会话限流 + 支持 Idempotency-Key（同其它写接口，06 §1）。
  const passwordRoute = {
    preHandler: [idempotency.preHandler],
    onSend: idempotency.onSend,
    config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: bySession } },
  };
  // 同 IP 120 次/分。05 §7 原写 10 次/分，但校园网出口共用一个 IP，一个班（≈60 人）同时登录时第 11 个人起全部 429；
  // 这里只防整段脚本式爆破，不防单个学号被猜。同邀请码失败锁定：未实现，策略需产品确认（见复审报告 P1-5）。
  app.post(
    '/auth/student/login',
    { config: { rateLimit: { max: config.rateLimits.login ?? LOGIN_MAX_PER_MINUTE, timeWindow: '1 minute' } } },
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
          ...(body.inviteCode === undefined ? {} : { inviteCode: body.inviteCode }),
          ...(body.password === undefined ? {} : { password: body.password }),
          studentNo: body.studentNo,
          deviceId: body.deviceId,
          ip: maskIp(request.ip),
          uaHash: userAgent === undefined ? null : sha256Hex(userAgent),
        });
      } catch (error) {
        // 只统计凭证失败（邀请码错/学号不在名单/学号或密码不对）；网络等其它错误不计。
        // PASSWORD_REQUIRED_LOGIN 不算：那是“该用密码登录”的提示，不是猜测。
        if (
          error instanceof AppError &&
          (error.code === 'INVALID_INVITE' || error.code === 'NOT_IN_ROSTER' || error.code === 'INVALID_CREDENTIALS')
        ) {
          loginThrottle.recordFailure(throttleKey);
        }
        throw error;
      }
      loginThrottle.reset(throttleKey);
      // 只下发学生 Cookie，不碰同一浏览器里的教师登录。
      setSessionCookie(reply, 'student', session.sessionId, session.expiresAt, { secure: secureCookie });

      const me = await buildMe(db, { userId: session.userId, role: 'student', sessionId: session.sessionId });
      contract.validate('Me', me);
      return me;
    },
  );

  // 设置 / 修改密码。首次设置（Me.needsPassword）不需要当前密码；allowPasswordSetup：开启强制时也放行这个接口。
  app.post('/auth/student/password', passwordRoute, async (request) => {
    const auth = await requireStudent(db, request, { allowPasswordSetup: true });
    contract.validateRequest('/auth/student/password', 'post', request.body);
    await setStudentPassword(db, config.piiKey, passwordThrottle, auth, request.body as PasswordChangeInput);
    return { ok: true };
  });

  // 13 §4：学生自选年龄段（名单未带时）。<14 也记录并返回 Me，但写接口守卫会 403 AGE_RESTRICTED。
  app.post('/auth/student/age-band', async (request) => {
    const auth = await requireStudent(db, request);
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
      setSessionCookie(reply, 'teacher', session.sessionId, session.expiresAt, { secure: secureCookie });

      const me = await buildMe(db, { userId: session.userId, role: session.role, sessionId: session.sessionId });
      contract.validate('Me', me);
      return me;
    },
  );

  app.post('/auth/teacher/password', passwordRoute, async (request) => {
    const auth = await requireApp(db, request, 'teacher');
    contract.validateRequest('/auth/teacher/password', 'post', request.body);
    await changeTeacherPassword(db, passwordThrottle, auth, request.body as Required<PasswordChangeInput>);
    return { ok: true };
  });

  // 退出所有设备：作废这个用户的全部会话（含当前），并清 x-pg-app 指明的那一端的 Cookie。不受“未设密码”限制。
  app.post('/auth/logout-all', async (request, reply) => {
    const side = sessionAppFor(request);
    const auth = await requireAuth(db, request, side);
    await revokeUserSessions(db, auth.userId);
    clearSessionCookie(reply, side, { secure: secureCookie });
    if (auth.legacy) clearSessionCookie(reply, LEGACY_SESSION_COOKIE, { secure: secureCookie });
    return reply.status(204).send();
  });

  // 退出只作废并清除 x-pg-app 指明的那一端（缺省学生）；另一端的会话与 Cookie 原样保留。
  app.post('/auth/logout', async (request, reply) => {
    const side = sessionAppFor(request);
    const auth = await requireAuth(db, request, side);
    await revokeSession(db, auth.sessionId);
    clearSessionCookie(reply, side, { secure: secureCookie });
    if (auth.legacy) clearSessionCookie(reply, LEGACY_SESSION_COOKIE, { secure: secureCookie });
    return reply.status(204).send();
  });

  // x-pg-app: student|teacher 指明读哪一端的 Cookie（缺省学生）。
  // 旧 pg_sid 在这里换成对应端的新 Cookie（同一个会话 id、同一个到期时间），并清掉旧的。
  app.get('/me', async (request, reply) => {
    const side = sessionAppFor(request);
    const auth = await requireAuth(db, request, side);
    if (auth.legacy && auth.expiresAt) {
      setSessionCookie(reply, side, auth.sessionId, auth.expiresAt, { secure: secureCookie });
      clearSessionCookie(reply, LEGACY_SESSION_COOKIE, { secure: secureCookie });
    }
    const me = await buildMe(db, auth);
    contract.validate('Me', me);
    return me;
  });
};
