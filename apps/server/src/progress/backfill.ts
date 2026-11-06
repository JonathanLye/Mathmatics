import { deserializeState, type SerializedAttemptState } from '@proof-gym/engine';

import { loadProblem, type LoadedProblem } from '../attempts/problem.ts';
import type { Db } from '../db/index.ts';

import { BLANK_REWARD_STATE, rewardStateOf } from './rewards.ts';
import { settleRewards } from './service.ts';

// 上线时对已有作答补一次经验台账（幂等：来源键唯一，重复运行不会重复入账）。
// 按完成时间（没完成的按最后更新时间）从早到晚处理，日期取那一刻的 Asia/Shanghai 自然日，所以连胜与徽章按历史重算。
// 不补：重做作答（重做不计经验）、进行中的测验（完成时才结算）。
export async function backfillProgress(db: Db): Promise<{ attempts: number; xpRows: number; badges: number }> {
  const before = await counts(db);
  const rows = (
    await db.query<{
      id: string;
      user_id: string;
      kind: 'main' | 'transfer';
      problem_id: string;
      problem_version: number;
      state: SerializedAttemptState;
      at: Date;
    }>(
      `select id, user_id, kind, problem_id, problem_version, state, coalesce(completed_at, updated_at) as at
         from app.attempts
        where kind in ('main', 'transfer') and not (mode = 'test' and status <> 'completed')
        order by coalesce(completed_at, updated_at), id`,
    )
  ).rows;
  const problems = new Map<string, LoadedProblem>();
  for (const row of rows) {
    const cacheKey = `${row.problem_id}@${row.problem_version}`;
    const cached = problems.get(cacheKey);
    const problem = cached ?? (await loadProblem(db, row.problem_id, row.problem_version));
    if (!cached) problems.set(cacheKey, problem);
    const after = rewardStateOf(deserializeState(row.state));
    const chapter = problem.public.chapter;
    await db.tx((tx) =>
      settleRewards(tx, {
        userId: row.user_id,
        attemptId: row.id,
        attemptKind: row.kind,
        problemId: row.problem_id,
        keyIds: problem.ctx.pkg.secret.keys.map((k) => k.id),
        ...(chapter === undefined ? {} : { chapter }),
        before: BLANK_REWARD_STATE,
        after,
        now: new Date(row.at).getTime(),
      }),
    );
  }
  const end = await counts(db);
  return { attempts: rows.length, xpRows: end.xp - before.xp, badges: end.badges - before.badges };
}

async function counts(db: Db): Promise<{ xp: number; badges: number }> {
  const r = (
    await db.query<{ xp: string; badges: string }>(
      `select (select count(*) from app.xp_ledger)::text as xp, (select count(*) from app.student_badges)::text as badges`,
    )
  ).rows[0];
  return { xp: Number(r?.xp ?? 0), badges: Number(r?.badges ?? 0) };
}
