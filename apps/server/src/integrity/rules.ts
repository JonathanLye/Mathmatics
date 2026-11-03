// 诚信规则的阈值与分数（11 §4、§5.2）。阈值改动要同步改文档，不要只改代码。

// 测验模式：离开满这么久才计 1 次（11 §5.2 "切出 ≥ 2 秒"）。
export const AWAY_COUNT_MIN_MS = 2000;
// 测验模式：第几次离开锁定。解锁后阈值 +1（11 §5.2 "计数不清零，阈值 +1"）。
export const BASE_LOCK_THRESHOLD = 3;
// paste_burst：单次粘贴字符数（11 §4）。
export const PASTE_BURST_CHARS = 30;
// multi_device：同一作答出现两个设备的时间窗（11 §4）。
export const MULTI_DEVICE_WINDOW_MINUTES = 5;

export const SIGNAL_SCORE = { paste_burst: 0.5, multi_device: 0.3 } as const;

export function lockThreshold(unlockCount: number): number {
  return BASE_LOCK_THRESHOLD + unlockCount;
}
