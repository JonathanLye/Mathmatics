// 识别并发控制（03 §3.1 第 2 步）。
// 文档里是 pg-boss 的 recog 队列（并发 = 已购 SimpleTex QPS，每生同时最多 2 个）。本地与单实例部署没有 Postgres 队列时，
// 用进程内的等价实现：全局并发上限 + 每生并发上限 + 排队超时。多实例时各实例独立计数（与登录限流一致，05 §7）。
export interface Slot {
  queueMs: number;
  release(): void;
}

export type AcquireResult = { ok: true; slot: Slot } | { ok: false; reason: 'user_busy' | 'queue_timeout' };

interface Waiter {
  userId: string;
  startedAt: number;
  resolve(result: AcquireResult): void;
  timer: ReturnType<typeof setTimeout>;
}

export class RecogLimiter {
  private active = 0;
  private readonly perUser = new Map<string, number>();
  private readonly waiters: Waiter[] = [];

  private readonly globalLimit: number;
  private readonly perUserLimit: number;

  constructor(globalLimit: number, perUserLimit: number) {
    this.globalLimit = globalLimit;
    this.perUserLimit = perUserLimit;
  }

  private userCount(userId: string): number {
    return this.perUser.get(userId) ?? 0;
  }

  private bump(userId: string, delta: number): void {
    const next = this.userCount(userId) + delta;
    if (next <= 0) this.perUser.delete(userId);
    else this.perUser.set(userId, next);
  }

  private makeSlot(userId: string, startedAt: number): Slot {
    let released = false;
    return {
      queueMs: Date.now() - startedAt,
      release: () => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.bump(userId, -1);
        this.drain();
      },
    };
  }

  private drain(): void {
    while (this.active < this.globalLimit && this.waiters.length > 0) {
      const waiter = this.waiters.shift() as Waiter;
      clearTimeout(waiter.timer);
      this.active += 1;
      waiter.resolve({ ok: true, slot: this.makeSlot(waiter.userId, waiter.startedAt) });
    }
  }

  // userId 的在途（含排队）请求已达上限 → user_busy（调用方返回 429）。排队超过 waitMs → queue_timeout（调用方降级到另一路）。
  acquire(userId: string, waitMs: number): Promise<AcquireResult> {
    if (this.userCount(userId) >= this.perUserLimit) return Promise.resolve({ ok: false, reason: 'user_busy' });
    const startedAt = Date.now();
    this.bump(userId, 1);
    if (this.active < this.globalLimit) {
      this.active += 1;
      return Promise.resolve({ ok: true, slot: this.makeSlot(userId, startedAt) });
    }
    return new Promise<AcquireResult>((resolve) => {
      const waiter: Waiter = {
        userId,
        startedAt,
        resolve,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          this.bump(userId, -1);
          resolve({ ok: false, reason: 'queue_timeout' });
        }, waitMs),
      };
      this.waiters.push(waiter);
    });
  }
}
