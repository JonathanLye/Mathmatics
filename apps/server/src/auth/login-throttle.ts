// #61：登录失败锁定（单实例内存实现；多实例部署时各自计数，限制写进 05 §7）。
// 设计取舍：
// - 学生按 (IP, 学号哈希) 计，**不按邀请码整体锁**——一个班共用一个出口 IP，按邀请码锁会把全班锁死；
// - 教师按账号（用户名小写）计，锁定期内返回与「密码错误」相同的 401 文案，不泄露锁定状态；
// - 只统计凭证失败（学生：邀请码/名单不匹配；教师：密码错或验证码错），成功登录清零。

export interface ThrottleOptions {
  /** 窗口内累计失败达到该次数后锁定。 */
  maxFailures: number;
  /** 失败统计窗口。 */
  windowMs: number;
  /** 锁定时长。 */
  lockMs: number;
}

export interface LockState {
  locked: boolean;
  retryAfterSec: number;
}

export interface LoginThrottle {
  check(key: string, now?: number): LockState;
  recordFailure(key: string, now?: number): void;
  reset(key: string): void;
}

interface Entry {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  maxFailures: 5,
  windowMs: 10 * 60_000,
  lockMs: 10 * 60_000,
};

export function createLoginThrottle(options: Partial<ThrottleOptions> = {}): LoginThrottle {
  const { maxFailures, windowMs, lockMs } = { ...DEFAULT_THROTTLE, ...options };
  const entries = new Map<string, Entry>();

  function expired(entry: Entry, now: number): boolean {
    return entry.lockedUntil <= now && now - entry.firstAt >= windowMs;
  }

  // 惰性清理：只在超过阈值时扫一遍，避免 Map 无界增长。
  function prune(now: number): void {
    if (entries.size < 10_000) return;
    for (const [key, entry] of entries) {
      if (expired(entry, now)) entries.delete(key);
    }
  }

  function check(key: string, now = Date.now()): LockState {
    const entry = entries.get(key);
    if (!entry) return { locked: false, retryAfterSec: 0 };
    if (entry.lockedUntil > now) {
      return { locked: true, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    // 锁定已到期，或窗口已过期：清零。
    if (entry.lockedUntil !== 0 || now - entry.firstAt >= windowMs) entries.delete(key);
    return { locked: false, retryAfterSec: 0 };
  }

  function recordFailure(key: string, now = Date.now()): void {
    let entry = entries.get(key);
    if (!entry || (entry.lockedUntil !== 0 && entry.lockedUntil <= now) || now - entry.firstAt >= windowMs) {
      entry = { count: 0, firstAt: now, lockedUntil: 0 };
    }
    if (entry.lockedUntil > now) return; // 已锁定：不重复累加，也不延长
    entry.count += 1;
    if (entry.count >= maxFailures) entry.lockedUntil = now + lockMs;
    entries.set(key, entry);
    prune(now);
  }

  function reset(key: string): void {
    entries.delete(key);
  }

  return { check, recordFailure, reset };
}
