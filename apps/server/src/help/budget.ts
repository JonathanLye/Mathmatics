// 模型调用的每生限流与每日预算（U15）。超了就不调用模型，调用方回退到模板 / 规则结果。
// 只数 model_calls 里真正生效（shadow=false）的调用；预算按当天（数据库时区）所有模型调用的费用合计。
import type { Queryable } from '../db/index.ts';

export interface BudgetConfig {
  dailyBudgetCny: number | null;
  studentCallsPer10Min: number;
}

export async function modelAllowed(
  db: Queryable,
  cfg: BudgetConfig,
  userId: string,
  purposes: readonly string[],
  perStudent: number = cfg.studentCallsPer10Min,
): Promise<boolean> {
  const used = await db.query<{ n: string }>(
    `select count(*) as n from app.model_calls mc join app.attempts a on a.id = mc.attempt_id
      where a.user_id = $1 and mc.purpose = any($2::text[]) and mc.shadow = false
        and mc.created_at > now() - interval '10 minutes'`,
    [userId, [...purposes]],
  );
  if (Number(used.rows[0]?.n ?? 0) >= perStudent) return false;
  if (cfg.dailyBudgetCny !== null) {
    const spent = await db.query<{ c: string | null }>(
      `select sum(cost_cny) as c from app.model_calls where created_at >= date_trunc('day', now())`,
    );
    if (Number(spent.rows[0]?.c ?? 0) >= cfg.dailyBudgetCny) return false;
  }
  return true;
}
