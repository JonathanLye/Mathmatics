// 连胜：按 Asia/Shanghai 自然日算，有实质进展（当天有经验入账）才算一天。
// 每周（周一到周日）自动有一张「请假卡」：某天没练习时，若这周的卡还没用且之前有连胜，就自动用掉，连胜不断也不增加。
// 今天还没练习不算断（今天还没结束）。纯函数，不读时钟。

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 时间戳 -> 上海自然日 YYYY-MM-DD
export function shanghaiDay(ms: number): string {
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

// 这一天所在周的周一（周一起算）
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0=周日
  return addDays(day, -((dow + 6) % 7));
}

export interface Streak {
  current: number;
  best: number;
  freezeAvailable: boolean;
  usedFreezeDays: string[];
}

export function computeStreak(activeDays: readonly string[], today: string): Streak {
  const active = new Set(activeDays);
  if (active.size === 0) return { current: 0, best: 0, freezeAvailable: true, usedFreezeDays: [] };
  const first = [...active].sort()[0] as string;
  const usedWeeks = new Set<string>();
  let current = 0;
  let best = 0;
  let frozen: string[] = [];
  for (let day = first; day <= today; day = addDays(day, 1)) {
    if (active.has(day)) {
      current += 1;
      best = Math.max(best, current);
    } else if (day !== today) {
      const week = weekStart(day);
      if (current > 0 && !usedWeeks.has(week)) {
        usedWeeks.add(week);
        frozen.push(day);
      } else {
        current = 0;
        frozen = [];
      }
    }
  }
  return { current, best, freezeAvailable: !usedWeeks.has(weekStart(today)), usedFreezeDays: frozen };
}
