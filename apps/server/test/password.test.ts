import { describe, expect, it } from 'vitest';

import { checkPasswordPolicy, createConcurrencyLimiter, hashPassword, verifyPassword, WEAK_PASSWORDS } from '../src/auth/password.ts';

describe('密码策略 checkPasswordPolicy', () => {
  it('8–64 位通过；7 位、65 位不通过', () => {
    expect(checkPasswordPolicy('abcdefgz', '2026001')).toBeNull();
    expect(checkPasswordPolicy('x'.repeat(63) + 'y', '2026001')).toBeNull();
    expect(checkPasswordPolicy('abcdefg', '2026001')).toMatch(/至少 8/);
    expect(checkPasswordPolicy('ab'.repeat(32) + 'c', '2026001')).toMatch(/最多 64/);
  });

  it('不限字符类型：空格、中文、emoji 都可以，长度按字符而不是字节计', () => {
    expect(checkPasswordPolicy('我的密码是这个吧', '2026001')).toBeNull();
    expect(checkPasswordPolicy('correct horse battery staple', '2026001')).toBeNull();
    expect(checkPasswordPolicy('😀😀😀😀😀😀😁😁', '2026001')).toBeNull();
    expect(checkPasswordPolicy('😀😀😀😀😀😀😀', '2026001')).not.toBeNull();
  });

  it('不能与学号相同（学号按 NFKC 归一后比较）', () => {
    expect(checkPasswordPolicy('20260001', '20260001')).toMatch(/学号/);
    expect(checkPasswordPolicy('２０２６００２２', '20260022')).toMatch(/学号/);
    expect(checkPasswordPolicy('20260002', '20260001')).toBeNull();
  });

  it('拦常见弱密码（大小写不敏感，含拼音经典），全是同一个字符也拦', () => {
    for (const weak of ['12345678', 'password', 'PassWord', 'qwertyui', '11111111', 'woaini1314', 'iloveyou', 'aaaaaaaaaa']) {
      expect(checkPasswordPolicy(weak, '2026001'), weak).not.toBeNull();
    }
    expect(WEAK_PASSWORDS.size).toBeGreaterThanOrEqual(150);
    // 弱密码表里每一项都得自己满足 8 位下限，否则这一项永远用不上。
    for (const entry of WEAK_PASSWORDS) expect([...entry].length, entry).toBeGreaterThanOrEqual(8);
  });
});

describe('argon2 并发限制', () => {
  it('同时最多 2 个在跑，其余排队；队列满了立即拒绝而不是无限等待', async () => {
    const limiter = createConcurrencyLimiter(2, 3);
    let running = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const job = () =>
      limiter.run(
        () =>
          new Promise<void>((resolve) => {
            running += 1;
            peak = Math.max(peak, running);
            release.push(() => {
              running -= 1;
              resolve();
            });
          }),
      );
    const settled = [job(), job(), job(), job(), job()]; // 2 在跑 + 3 排队
    await new Promise((r) => setTimeout(r, 10));
    expect(running).toBe(2);
    await expect(job()).rejects.toMatchObject({ code: 'RATE_LIMITED', statusCode: 429 });
    while (release.length > 0) {
      release.shift()?.();
      await new Promise((r) => setTimeout(r, 5));
    }
    await Promise.all(settled);
    expect(peak).toBe(2);
  });

  it('任务抛错不会占住名额', async () => {
    const limiter = createConcurrencyLimiter(1, 2);
    await expect(limiter.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('hashPassword / verifyPassword', () => {
  it('argon2id 哈希可校验，错误密码与坏哈希都返回 false', async () => {
    const hashed = await hashPassword('correct horse battery');
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hashed, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hashed, 'correct horse batterx')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
