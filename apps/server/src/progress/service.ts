import type { ContractValidator } from '../contract.ts';
import type { Db, Queryable } from '../db/index.ts';
import { AppError } from '../errors.ts';

import { BADGES, badgeById } from './badges.ts';
import {
  computeRewards,
  sourceKeysFor,
  type RewardContext,
  type RewardState,
  type SolutionRevealLevel,
} from './rewards.ts';
import { addDays, computeStreak, shanghaiDay, weekStart } from './streak.ts';

// 进度与奖励的库操作。规则都在 rewards.ts / streak.ts（纯函数）；这里只负责读上下文、写台账和拼 DTO。

export const DEFAULT_DAILY_GOAL = 3;

export interface RewardsDto {
  xp: number;
  items: Array<{ kind: string; amount: number; label: string }>;
  badges: Array<{ id: string; title: string; desc: string }>;
  streak?: { current: number; extended: boolean };
  goalReached?: boolean;
}

export interface SettleInput {
  userId: string;
  attemptId: string;
  attemptKind: 'main' | 'transfer' | 'redo';
  problemId: string;
  keyIds: readonly string[];
  chapter?: string;
  before: RewardState;
  after: RewardState;
  now: number;
  // 练习区看过题解的程度（由题解模块提供，缺省 none）
  solutionRevealLevel?: SolutionRevealLevel;
}

// 在作答写入的同一个事务里调用。没有任何新经验和新徽章时返回 null。
export async function settleRewards(tx: Queryable, input: SettleInput): Promise<RewardsDto | null> {
  const day = shanghaiDay(input.now);
  const keys = sourceKeysFor(input.problemId, input.keyIds);

  const existing = new Set(
    (
      await tx.query<{ source_key: string }>(
        `select source_key from app.xp_ledger where user_id = $1 and source_key = any($2::text[])`,
        [input.userId, keys],
      )
    ).rows.map((r) => r.source_key),
  );
  const today = (
    await tx.query<{ daily: string; keys: string }>(
      `select count(*) filter (where kind = 'daily')::text as daily,
              count(*) filter (where kind in ('key_own', 'key_hinted'))::text as keys
         from app.xp_ledger where user_id = $1 and day = $2::date`,
      [input.userId, day],
    )
  ).rows[0];
  const dailyGoal = await goalOf(tx, input.userId);
  const earned = new Set(
    (await tx.query<{ badge_id: string }>(`select badge_id from app.student_badges where user_id = $1`, [input.userId])).rows.map(
      (r) => r.badge_id,
    ),
  );
  const days = await ledgerDays(tx, input.userId);

  const justFinished = input.after.done && !input.before.done;
  const chapterCleared = justFinished && input.attemptKind === 'main' ? await chapterIsCleared(tx, input.userId, input.chapter) : false;

  const ctx: RewardContext = {
    problemId: input.problemId,
    kind: input.attemptKind,
    day,
    existingKeys: existing,
    dailyDone: Number(today?.daily ?? 0) > 0,
    keysTodayBefore: Number(today?.keys ?? 0),
    dailyGoal,
    streakIfActive: computeStreak([...days, day], day).current,
    earnedBadges: earned,
    chapterCleared,
    ...(input.solutionRevealLevel === undefined ? {} : { solutionRevealLevel: input.solutionRevealLevel }),
  };
  const result = computeRewards(input.before, input.after, ctx);

  const insert = async (row: { sourceKey: string; kind: string; amount: number; label: string }) => {
    const r = await tx.query(
      `insert into app.xp_ledger (user_id, source_key, kind, amount, day, attempt_id)
       values ($1, $2, $3, $4, $5::date, $6)
       on conflict (user_id, source_key) do nothing returning id`,
      [input.userId, row.sourceKey, row.kind, row.amount, day, input.attemptId],
    );
    return r.rows.length > 0;
  };
  const items: RewardsDto['items'] = [];
  for (const row of result.rows) {
    if (await insert(row)) items.push({ kind: row.kind, amount: row.amount, label: row.label });
  }
  // 每天首次：只有这一步真的记入了新经验才发
  if (items.length > 0 && result.dailyRow && (await insert(result.dailyRow))) {
    items.push({ kind: result.dailyRow.kind, amount: result.dailyRow.amount, label: result.dailyRow.label });
  }

  const badges: RewardsDto['badges'] = [];
  for (const id of result.badges) {
    const r = await tx.query(
      `insert into app.student_badges (user_id, badge_id) values ($1, $2) on conflict (user_id, badge_id) do nothing returning badge_id`,
      [input.userId, id],
    );
    const def = badgeById(id);
    if (r.rows.length > 0 && def) badges.push({ id, title: def.title, desc: def.desc });
  }

  if (items.length === 0 && badges.length === 0) return null;
  const dto: RewardsDto = { xp: items.reduce((sum, i) => sum + i.amount, 0), items, badges };
  if (items.length > 0) dto.streak = { current: ctx.streakIfActive, extended: !ctx.dailyDone };
  if (result.goalReached && items.length > 0) dto.goalReached = true;
  return dto;
}

async function goalOf(q: Queryable, userId: string): Promise<number> {
  const r = await q.query<{ daily_goal: number }>(`select daily_goal from app.student_settings where user_id = $1`, [userId]);
  return Number(r.rows[0]?.daily_goal ?? DEFAULT_DAILY_GOAL);
}

async function ledgerDays(q: Queryable, userId: string): Promise<string[]> {
  return (
    await q.query<{ day: string }>(`select distinct day::text as day from app.xp_ledger where user_id = $1 order by 1`, [userId])
  ).rows.map((r) => r.day);
}

// 单元通关：本人班级里布置过的、同一章的题（至少两道）都已完成。
async function chapterIsCleared(q: Queryable, userId: string, chapter: string | undefined): Promise<boolean> {
  if (!chapter) return false;
  const r = (
    await q.query<{ total: string; pending: string }>(
      `select count(*)::text as total, count(*) filter (where att.status is distinct from 'completed')::text as pending
         from app.assignments a
         join app.class_members m on m.class_id = a.class_id and m.user_id = $1 and m.left_at is null
         join content.problem_versions pv on pv.problem_id = a.problem_id and pv.version = a.problem_version
         left join app.attempts att on att.assignment_id = a.id and att.user_id = $1 and att.kind = 'main'
        where a.status <> 'cancelled' and pv.public->>'chapter' = $2`,
      [userId, chapter],
    )
  ).rows[0];
  return Number(r?.total ?? 0) >= 2 && Number(r?.pending ?? 1) === 0;
}

// GET /student/progress
export async function buildProgress(db: Queryable, contract: ContractValidator, userId: string, now = Date.now()): Promise<Record<string, unknown>> {
  const today = shanghaiDay(now);
  const totals = (
    await db.query<{ xp_total: string; xp_today: string; keys_today: string }>(
      `select coalesce(sum(amount), 0)::text as xp_total,
              coalesce(sum(amount) filter (where day = $2::date), 0)::text as xp_today,
              count(*) filter (where day = $2::date and kind in ('key_own', 'key_hinted'))::text as keys_today
         from app.xp_ledger where user_id = $1`,
      [userId, today],
    )
  ).rows[0];
  const days = await ledgerDays(db, userId);
  const streak = computeStreak(days, today);

  const monday = weekStart(today);
  const perDay = new Map(
    (
      await db.query<{ day: string; xp: string; keys: string }>(
        `select day::text as day, sum(amount)::text as xp, count(*) filter (where kind in ('key_own', 'key_hinted'))::text as keys
           from app.xp_ledger where user_id = $1 and day >= $2::date and day <= $3::date group by day`,
        [userId, monday, addDays(monday, 6)],
      )
    ).rows.map((r) => [r.day, r] as const),
  );
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    return { day, xp: Number(perDay.get(day)?.xp ?? 0), keys: Number(perDay.get(day)?.keys ?? 0) };
  });

  const earned = new Map(
    (await db.query<{ badge_id: string; earned_at: Date }>(`select badge_id, earned_at from app.student_badges where user_id = $1`, [userId])).rows.map(
      (r) => [r.badge_id, new Date(r.earned_at).toISOString()] as const,
    ),
  );
  const streakTarget: Record<string, number> = { streak_3: 3, streak_7: 7, streak_30: 30 };
  const badges = BADGES.map((b) => {
    const earnedAt = earned.get(b.id) ?? null;
    const target = streakTarget[b.id];
    return {
      id: b.id,
      title: b.title,
      desc: b.desc,
      earnedAt,
      ...(target === undefined ? {} : { progress: { current: Math.min(target, streak.current), target } }),
    };
  });

  const dto = {
    xpTotal: Number(totals?.xp_total ?? 0),
    xpToday: Number(totals?.xp_today ?? 0),
    keysToday: Number(totals?.keys_today ?? 0),
    dailyGoal: await goalOf(db, userId),
    streak,
    week,
    badges,
    daysLearned: days.length,
  };
  contract.validate('StudentProgress', dto);
  return dto;
}

// ---- 设置 ----

export interface SettingsDto {
  nickname: string | null;
  dailyGoal: number;
  defaultInput: 'hand' | 'keyboard' | 'photo';
  theme: 'system' | 'light' | 'dark';
  sound: boolean;
  motion: boolean;
  haptics: boolean;
  onboarding: Record<string, unknown>;
}

type SettingsRow = {
  daily_goal: number;
  default_input: SettingsDto['defaultInput'];
  theme: SettingsDto['theme'];
  sound: boolean;
  motion: boolean;
  haptics: boolean;
  onboarding: Record<string, unknown>;
  display_name: string | null;
};

export async function loadSettings(q: Queryable, contract: ContractValidator, userId: string): Promise<SettingsDto> {
  const row = (
    await q.query<SettingsRow>(
      `select u.display_name, s.daily_goal, s.default_input, s.theme, s.sound, s.motion, s.haptics, s.onboarding
         from app.users u left join app.student_settings s on s.user_id = u.id where u.id = $1`,
      [userId],
    )
  ).rows[0];
  if (!row) throw new AppError('NOT_FOUND', 404, '找不到用户');
  const dto: SettingsDto = {
    nickname: row.display_name,
    dailyGoal: Number(row.daily_goal ?? DEFAULT_DAILY_GOAL),
    defaultInput: row.default_input ?? 'hand',
    theme: row.theme ?? 'system',
    sound: row.sound ?? true,
    motion: row.motion ?? true,
    haptics: row.haptics ?? true,
    onboarding: row.onboarding ?? {},
  };
  contract.validate('StudentSettings', dto);
  return dto;
}

export interface SettingsPatch {
  nickname?: string;
  dailyGoal?: number;
  defaultInput?: SettingsDto['defaultInput'];
  theme?: SettingsDto['theme'];
  sound?: boolean;
  motion?: boolean;
  haptics?: boolean;
  onboarding?: Record<string, unknown>;
}

export async function patchSettings(db: Db, contract: ContractValidator, userId: string, patch: SettingsPatch): Promise<SettingsDto> {
  let nickname: string | undefined;
  if (patch.nickname !== undefined) {
    nickname = patch.nickname.trim();
    const length = [...nickname].length;
    if (length < 1 || length > 16) throw new AppError('VALIDATION_FAILED', 422, '昵称需要 1 到 16 个字');
  }
  await db.tx(async (tx) => {
    // onboarding 是整体替换的小对象（重看引导的进度）；其余字段缺省则保持原值
    await tx.query(`insert into app.student_settings (user_id) values ($1) on conflict (user_id) do nothing`, [userId]);
    await tx.query(
      `update app.student_settings
          set daily_goal = coalesce($2, daily_goal),
              default_input = coalesce($3, default_input),
              theme = coalesce($4, theme),
              sound = coalesce($5, sound),
              motion = coalesce($6, motion),
              haptics = coalesce($7, haptics),
              onboarding = coalesce($8::jsonb, onboarding),
              updated_at = now()
        where user_id = $1`,
      [
        userId,
        patch.dailyGoal ?? null,
        patch.defaultInput ?? null,
        patch.theme ?? null,
        patch.sound ?? null,
        patch.motion ?? null,
        patch.haptics ?? null,
        patch.onboarding === undefined ? null : JSON.stringify(patch.onboarding),
      ],
    );
    if (nickname !== undefined) await tx.query(`update app.users set display_name = $2 where id = $1`, [userId, nickname]);
  });
  return loadSettings(db, contract, userId);
}

export async function submitFeedback(
  db: Queryable,
  userId: string,
  body: { kind: 'bug' | 'idea' | 'content' | 'other'; body: string; page?: string },
): Promise<void> {
  const text = body.body.trim();
  if (text.length < 1) throw new AppError('VALIDATION_FAILED', 422, '请写一点内容再提交');
  await db.query(`insert into app.student_feedback (user_id, kind, body, page) values ($1, $2, $3, $4)`, [
    userId,
    body.kind,
    text,
    body.page ?? null,
  ]);
}
