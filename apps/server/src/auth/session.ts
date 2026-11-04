import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

// 05 §7：pg_sid HttpOnly、Secure、SameSite=Lax；学生 30 天；登出即作废。
// 服务端会话表 app.auth_sessions 是事实来源；Cookie 上的值由 @fastify/cookie 用 SESSION_SECRET 签名，
// 库里即使泄露 id 也无法伪造 Cookie。
export const SESSION_COOKIE = 'pg_sid';
export const STUDENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Role = 'student' | 'teacher' | 'admin';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
}

export interface CreateSessionInput {
  userId: string;
  // 教师登录不带设备 id（契约里只有学生登录有 deviceId），此时为 null。
  deviceId: string | null;
  ip: string | null;
  ttlMs: number;
}

export async function createSession(db: Queryable, input: CreateSessionInput): Promise<{ id: string; expiresAt: Date }> {
  // 会话 id 用 v4（122 位随机）而不是 v7：v7 含时间戳，会话 id 不应暴露登录时刻。
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + input.ttlMs);
  await db.query(
    `insert into app.auth_sessions (id, user_id, device_id, expires_at, ip_masked)
     values ($1, $2, $3, $4, $5)`,
    [id, input.userId, input.deviceId, expiresAt, input.ip],
  );
  return { id, expiresAt };
}

// 限流键：已登录请求按会话 id 计，没有有效会话才退回 IP。校园网出口共用一个 IP，按 IP 计会让同班同学互相挤占额度。
// Cookie 必须先验签并确认是服务端生成的 UUID，否则伪造值会给攻击者开新桶（把正常会话的计数挤出限流窗口）。
export function bySession(request: FastifyRequest): string {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return request.ip;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && UUID_PATTERN.test(unsigned.value) ? unsigned.value : request.ip;
}

// 生产/测试强制 Secure；开发环境（http://内网 IP 演示）由调用方放开（#67-1 / #58 评审 P2-2）。
export function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  expiresAt: Date,
  options: { secure?: boolean } = {},
): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    secure: options.secure ?? true,
    sameSite: 'lax',
    signed: true,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, options: { secure?: boolean } = {}): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: options.secure ?? true,
    sameSite: 'lax',
  });
}

export async function revokeSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(`update app.auth_sessions set revoked_at = now() where id = $1 and revoked_at is null`, [sessionId]);
}

// 无 Cookie、签名不对、会话过期或吊销、账号停用，都返回 null。
export async function currentAuth(db: Queryable, request: FastifyRequest): Promise<AuthContext | null> {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;

  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !UUID_PATTERN.test(unsigned.value)) return null;

  const result = await db.query<{ user_id: string; role: Role }>(
    `select u.id as user_id, u.role
       from app.auth_sessions s
       join app.users u on u.id = s.user_id
      where s.id = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.status = 'active'`,
    [unsigned.value],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, role: row.role, sessionId: unsigned.value } : null;
}

export async function requireAuth(db: Queryable, request: FastifyRequest): Promise<AuthContext> {
  const auth = await currentAuth(db, request);
  if (!auth) throw new AppError('UNAUTHORIZED', 401, '请先登录');
  return auth;
}
