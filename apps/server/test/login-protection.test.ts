import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTeacherAccount } from '../src/auth/teacher-login.ts';
import type { Db } from '../src/db/index.ts';

import { buildTestApp, loginBody, setupFixture, WRITE_HEADERS, type Fixture } from './support/fixtures.ts';

// #61：登录失败锁定（单实例内存，5 次 / 10 分钟）。
// 关键约束：学生按 (IP, 学号哈希) 计、不按邀请码整体锁（一个班共用一个出口 IP，锁邀请码会锁全班）。
let fx: Fixture;
let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  fx = await setupFixture();
  db = fx.db;
  app = await buildTestApp(db);
});

afterEach(async () => {
  await app.close();
  await fx.close();
});

const studentLogin = (overrides: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/student/login', headers: WRITE_HEADERS, payload: loginBody(overrides) });

const teacherLogin = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/teacher/login', headers: WRITE_HEADERS, payload });

describe('登录失败锁定（#61）', () => {
  it('学生：同一 (IP, 学号) 连续 5 次凭证失败后 429，别的学号不受影响', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await studentLogin({ inviteCode: 'WRONG1' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_INVITE');
    }
    const locked = await studentLogin({ inviteCode: 'WRONG1' });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('RATE_LIMITED');
    expect(locked.json().error.detail.retryAfterSec).toBeGreaterThan(500);

    // 同 IP 的另一个学号（不同 key）不受影响：说明没有按邀请码/IP 整体锁。
    const other = await studentLogin({ studentNo: '2026999', inviteCode: 'WRONG1' });
    expect(other.statusCode).toBe(401);
    expect(other.json().error.code).toBe('INVALID_INVITE');
  });

  it('学生：成功登录清零失败计数', async () => {
    for (let i = 0; i < 4; i += 1) expect((await studentLogin({ inviteCode: 'WRONG1' })).statusCode).toBe(401);
    expect((await studentLogin()).statusCode).toBe(200);
    // 计数已清零：再失败 4 次仍不锁；第 5 次失败触发锁定（本次仍是 401），第 6 次 429。
    for (let i = 0; i < 4; i += 1) expect((await studentLogin({ inviteCode: 'WRONG1' })).statusCode).toBe(401);
    expect((await studentLogin({ inviteCode: 'WRONG1' })).statusCode).toBe(401);
    expect((await studentLogin({ inviteCode: 'WRONG1' })).statusCode).toBe(429);
  });

  it('教师：同一账号连续 5 次密码错后锁定（与密码错同一文案），其他账号不受影响', async () => {
    await createTeacherAccount(db, { username: 'lock.teacher', password: 'correct horse battery' });
    await createTeacherAccount(db, { username: 'other.teacher', password: 'correct horse battery' });

    for (let i = 0; i < 5; i += 1) {
      const res = await teacherLogin({ username: 'lock.teacher', password: 'wrong password' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.message).toBe('用户名或密码不对');
    }
    // 锁定后即使密码正确也 401，且文案不变（不泄露锁定状态）。
    const locked = await teacherLogin({ username: 'lock.teacher', password: 'correct horse battery' });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error.message).toBe('用户名或密码不对');

    const other = await teacherLogin({ username: 'other.teacher', password: 'correct horse battery' });
    expect(other.statusCode).toBe(200);
  });
});
