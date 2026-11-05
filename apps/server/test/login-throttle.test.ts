import { describe, expect, it } from 'vitest';

import { createLoginThrottle } from '../src/auth/login-throttle.ts';

// #61：登录失败锁定（单实例内存）。学生按 (IP, 学号哈希)，教师按账号；
// 不按邀请码整体锁（会把全班锁住）。锁定状态供路由返回 429/401。
describe('登录失败锁定（#61）', () => {
  it('连续失败达到阈值后锁定，返回剩余等待秒数', () => {
    const throttle = createLoginThrottle({ maxFailures: 3, lockMs: 600_000 });
    const t0 = 1_800_000_000_000;
    expect(throttle.check('k', t0)).toEqual({ locked: false, retryAfterSec: 0 });
    throttle.recordFailure('k', t0);
    throttle.recordFailure('k', t0 + 1000);
    throttle.recordFailure('k', t0 + 2000);
    const state = throttle.check('k', t0 + 3000);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSec).toBeGreaterThan(590);
    expect(state.retryAfterSec).toBeLessThanOrEqual(600);
  });

  it('锁定期内不再累加；到期自动解锁', () => {
    const throttle = createLoginThrottle({ maxFailures: 2, lockMs: 60_000 });
    const t0 = 1_800_000_000_000;
    throttle.recordFailure('k', t0);
    throttle.recordFailure('k', t0);
    expect(throttle.check('k', t0 + 1).locked).toBe(true);
    // 到期后恢复（count 归零）。
    expect(throttle.check('k', t0 + 60_001)).toEqual({ locked: false, retryAfterSec: 0 });
  });

  it('成功登录清零；不同 key 互不影响', () => {
    const throttle = createLoginThrottle({ maxFailures: 3, lockMs: 600_000 });
    const t0 = 1_800_000_000_000;
    throttle.recordFailure('a', t0);
    throttle.recordFailure('a', t0);
    throttle.reset('a');
    throttle.recordFailure('a', t0);
    expect(throttle.check('a', t0).locked).toBe(false);

    throttle.recordFailure('b', t0);
    throttle.recordFailure('b', t0);
    throttle.recordFailure('b', t0);
    expect(throttle.check('b', t0).locked).toBe(true);
    expect(throttle.check('a', t0).locked).toBe(false);
  });

  it('失败之间有间隔时窗口也计时（10 分钟内累计达到阈值即锁）', () => {
    const throttle = createLoginThrottle({ maxFailures: 2, lockMs: 60_000, windowMs: 600_000 });
    const t0 = 1_800_000_000_000;
    throttle.recordFailure('k', t0);
    throttle.recordFailure('k', t0 + 300_000);
    expect(throttle.check('k', t0 + 300_001).locked).toBe(true);
    // 超过统计窗口后旧失败被丢弃。
    expect(throttle.check('k', t0 + 900_001).locked).toBe(false);
  });
});
