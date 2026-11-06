import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

// 05 §7：会话 Cookie 按端拆开——学生 pg_sid_s（30 天）、教师 pg_sid_t（12 小时），均 HttpOnly、Secure、SameSite=Lax；登出即作废。
// 同一浏览器可同时登录两端、互不覆盖：/teacher*、/auth/teacher* 读教师 Cookie，其余读学生 Cookie；
// 只有 /me、/auth/logout 由客户端带 x-pg-app: student|teacher 指明（缺省按学生）。
// 旧的共用 pg_sid 只读兼容：选中的新 Cookie 不在时，才读 pg_sid，且只有会话主人的角色与请求的那一端相符才认；/me 时换成新 Cookie。
// 服务端会话表 app.auth_sessions 是事实来源；Cookie 上的值由 @fastify/cookie 用 SESSION_SECRET 签名，
// 库里即使泄露 id 也无法伪造 Cookie。
export const STUDENT_SESSION_COOKIE = 'pg_sid_s';
export const TEACHER_SESSION_COOKIE = 'pg_sid_t';
export const LEGACY_SESSION_COOKIE = 'pg_sid';
export const APP_HEADER = 'x-pg-app';
export const STUDENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Role = 'student' | 'teacher' | 'admin';
export type SessionApp = 'student' | 'teacher';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  /** 会话到期时间（旧 Cookie 换新 Cookie 时沿用）。 */
  expiresAt?: Date;
  /** 这次是靠旧的 pg_sid 认出来的（只读兼容）。 */
  legacy?: boolean;
}

export const cookieNameFor = (app: SessionApp): string => (app === 'teacher' ? TEACHER_SESSION_COOKIE : STUDENT_SESSION_COOKIE);
const otherApp = (app: SessionApp): SessionApp => (app === 'teacher' ? 'student' : 'teacher');
const roleBelongsTo = (app: SessionApp, role: Role): boolean => (app === 'teacher' ? role === 'teacher' || role === 'admin' : role === 'student');

// /teacher*、/auth/teacher*（/api/v1 之后）读教师 Cookie。用 Fastify 匹配出的路由模板而不是原始 URL，
// 这样百分号编码、重复斜杠之类的写法不会让“看起来是学生路径”的请求实际走到教师处理器。
const TEACHER_ROUTE = /^\/(?:teacher|auth\/teacher)(?:\/|$)/;
// 这些接口两端共用，由 x-pg-app 指明身份。
const HEADER_ROUTES = new Set(['/me', '/auth/logout', '/events/batch']);

function routeOf(request: FastifyRequest): string {
  const route = request.routeOptions?.url ?? (request.url ?? '').split('?')[0] ?? '';
  return route.replace(/^\/api\/v1(?=\/)/, '');
}

export function sessionAppFor(request: FastifyRequest): SessionApp {
  const route = routeOf(request);
  if (TEACHER_ROUTE.test(route)) return 'teacher';
  if (HEADER_ROUTES.has(route) && request.headers?.[APP_HEADER] === 'teacher') return 'teacher';
  return 'student';
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
// 键取本请求所属那一端的 Cookie（同一浏览器两个 Cookie 各算各的桶）；新 Cookie 不在时回看旧 pg_sid。
function signedSessionId(request: FastifyRequest, name: string): string | null {
  const raw = request.cookies[name];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && UUID_PATTERN.test(unsigned.value) ? unsigned.value : null;
}

export function bySession(request: FastifyRequest): string {
  const app = sessionAppFor(request);
  if (request.cookies[cookieNameFor(app)]) return signedSessionId(request, cookieNameFor(app)) ?? request.ip;
  return signedSessionId(request, LEGACY_SESSION_COOKIE) ?? request.ip;
}

// 生产/测试强制 Secure；开发环境（http://内网 IP 演示）由调用方放开（#67-1 / #58 评审 P2-2）。
export function setSessionCookie(
  reply: FastifyReply,
  app: SessionApp,
  sessionId: string,
  expiresAt: Date,
  options: { secure?: boolean } = {},
): void {
  reply.setCookie(cookieNameFor(app), sessionId, {
    path: '/',
    httpOnly: true,
    secure: options.secure ?? true,
    sameSite: 'lax',
    signed: true,
    expires: expiresAt,
  });
}

// 清某一端的新 Cookie；把旧 pg_sid 换成新 Cookie 时传 LEGACY_SESSION_COOKIE 清旧的。
export function clearSessionCookie(
  reply: FastifyReply,
  app: SessionApp | typeof LEGACY_SESSION_COOKIE,
  options: { secure?: boolean } = {},
): void {
  reply.clearCookie(app === LEGACY_SESSION_COOKIE ? LEGACY_SESSION_COOKIE : cookieNameFor(app), {
    path: '/',
    httpOnly: true,
    secure: options.secure ?? true,
    sameSite: 'lax',
  });
}

export async function revokeSession(db: Queryable, sessionId: string): Promise<void> {
  await db.query(`update app.auth_sessions set revoked_at = now() where id = $1 and revoked_at is null`, [sessionId]);
}

async function loadSession(db: Queryable, sessionId: string): Promise<AuthContext | null> {
  const result = await db.query<{ user_id: string; role: Role; expires_at: Date | string }>(
    `select u.id as user_id, u.role, s.expires_at
       from app.auth_sessions s
       join app.users u on u.id = s.user_id
      where s.id = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and u.status = 'active'`,
    [sessionId],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, role: row.role, sessionId, expiresAt: new Date(row.expires_at) } : null;
}

// 无 Cookie、签名不对、会话过期或吊销、账号停用，都返回 null。
// app 缺省按请求路径/头推断；只看这一端的 Cookie。新 Cookie 不在时回看旧 pg_sid，且会话主人的角色必须属于这一端。
export async function currentAuth(
  db: Queryable,
  request: FastifyRequest,
  app: SessionApp = sessionAppFor(request),
): Promise<AuthContext | null> {
  const name = cookieNameFor(app);
  if (request.cookies[name] !== undefined) {
    const id = signedSessionId(request, name);
    return id === null ? null : loadSession(db, id);
  }
  const legacyId = signedSessionId(request, LEGACY_SESSION_COOKIE);
  if (legacyId === null) return null;
  const legacy = await loadSession(db, legacyId);
  return legacy && roleBelongsTo(app, legacy.role) ? { ...legacy, legacy: true } : null;
}

export async function requireAuth(db: Queryable, request: FastifyRequest, app?: SessionApp): Promise<AuthContext> {
  const auth = await currentAuth(db, request, app);
  if (!auth) throw new AppError('UNAUTHORIZED', 401, '请先登录');
  return auth;
}

// 两端守卫：没有任何会话 401；会话在，但属于另一端（或角色不符）403 { reason: 'wrong_app' }。
// 只有守卫内部才去看另一端的 Cookie——其余代码一律只读本端 Cookie。两端客户端都把 401 和 wrong_app 当作“回登录页”。
const WRONG_APP_MESSAGE: Record<SessionApp, string> = { student: '请用学生账号登录', teacher: '需要教师账号' };

export async function requireApp(db: Queryable, request: FastifyRequest, app: SessionApp): Promise<AuthContext> {
  const auth = await currentAuth(db, request, app);
  if (auth && roleBelongsTo(app, auth.role)) return auth;
  const other = auth === null ? await currentAuth(db, request, otherApp(app)) : null;
  if (auth !== null || (other !== null && roleBelongsTo(otherApp(app), other.role))) throw new AppError('FORBIDDEN', 403, WRONG_APP_MESSAGE[app], { reason: 'wrong_app' });
  throw new AppError('UNAUTHORIZED', 401, '请先登录');
}

export const requireStudent = (db: Queryable, request: FastifyRequest): Promise<AuthContext> => requireApp(db, request, 'student');
