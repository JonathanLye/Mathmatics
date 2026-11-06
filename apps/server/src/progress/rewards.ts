import type { AttemptState } from '@proof-gym/engine';

import { BADGES, type BadgeId } from './badges.ts';

// 经验与徽章的规则（12 / 学生端「进度与奖励」）。这里只有纯函数：同样的输入永远得到同样的输出，不读库、不读时钟。
// 规则（按键写出的步骤、层、题计分；行数不计分；提示本身不计分；测验期间不结算，完成时一次结算）：
//   独立写出关键步骤 +10；用过 H2 及以上提示才写出的 +3；完成一层 +5；完成一题 +20；每天首次有进展 +5。
// 防刷：每条经验有来源键（用户内唯一，库里 unique(user_id, source_key)）。键由「题 + 步骤/层」组成，不含作答 ID，
// 所以同一题重做、重复提交、重放请求都拿不到第二次经验。

export type SolutionRevealLevel = 'none' | 'approach' | 'full';

export const XP = { keyOwn: 10, keyHinted: 3, layer: 5, problem: 20, daily: 5 } as const;

// 奖励计算只关心引擎状态里的这几项。
export interface RewardState {
  done: boolean;
  // 层号 -> 'done' | 'skip' | 'disabled'
  layerStatus: Readonly<Record<number, string>>;
  // 已写出（计入）的关键步骤
  matched: readonly string[];
  // 其中靠 H2 及以上提示（或 H4 示范、教师补发）才写出的
  hinted: readonly string[];
  reveal: number;
  overrides: number;
}

export const BLANK_REWARD_STATE: RewardState = { done: false, layerStatus: {}, matched: [], hinted: [], reveal: 0, overrides: 0 };

export function rewardStateOf(state: AttemptState): RewardState {
  const matched = [...state.hint.matched];
  const viaHint = new Set(state.viaHint);
  return {
    done: state.done,
    layerStatus: state.status,
    matched,
    hinted: matched.filter((k) => (state.hint.keyCost[k] ?? 0) > 0 || viaHint.has(k)),
    reveal: state.hint.reveal,
    overrides: (state.overrides ?? []).length,
  };
}

export interface RewardContext {
  problemId: string;
  kind: 'main' | 'transfer' | 'redo';
  // 上海自然日 YYYY-MM-DD
  day: string;
  // 库里已有的、与本题相关的来源键（见 sourceKeysFor）。命中的不再发。
  existingKeys: ReadonlySet<string>;
  // 今天是否已经发过「每天首次」
  dailyDone: boolean;
  // 今天此前已经自己写出（含借助提示）的关键步骤数，用于判断是否达到每日目标
  keysTodayBefore: number;
  dailyGoal: number;
  // 假设今天有进展，连胜会是多少（由调用方用库里的日期算出）
  streakIfActive: number;
  earnedBadges: ReadonlySet<string>;
  // 本题所在单元（章）里被布置的题是否都已完成
  chapterCleared: boolean;
  // 练习区学生看过题解的程度（由别的模块提供；缺省 none）
  solutionRevealLevel?: SolutionRevealLevel;
}

export interface LedgerRow {
  sourceKey: string;
  kind: 'key_own' | 'key_hinted' | 'layer' | 'problem' | 'daily';
  amount: number;
  label: string;
}

export interface RewardResult {
  // 本次要写入的经验（不含每天首次）
  rows: LedgerRow[];
  // 每天首次：只有 rows 里真的有东西落库时才一并写入（由调用方判断）
  dailyRow: LedgerRow | null;
  badges: BadgeId[];
  xp: number;
  goalReached: boolean;
}

export const keySource = (problemId: string, keyId: string): string => `key:${problemId}:${keyId}`;
export const layerSource = (problemId: string, layer: number): string => `layer:${problemId}:L${layer}`;
export const doneSource = (problemId: string): string => `done:${problemId}`;
export const dailySource = (day: string): string => `daily:${day}`;

// 一道题可能出现的全部来源键：调用方一次查库得到 existingKeys。
export function sourceKeysFor(problemId: string, keyIds: readonly string[]): string[] {
  return [
    ...keyIds.map((k) => keySource(problemId, k)),
    ...[1, 2, 3, 4, 5, 6].map((n) => layerSource(problemId, n)),
    doneSource(problemId),
  ];
}

// 比较前后状态，给出这一步应得的经验与徽章。before 在测验中取 BLANK_REWARD_STATE（完成时一次结算）。
export function computeRewards(before: RewardState, after: RewardState, ctx: RewardContext): RewardResult {
  const reveal = ctx.solutionRevealLevel ?? 'none';
  const rows: LedgerRow[] = [];
  const add = (row: LedgerRow): void => {
    if (!ctx.existingKeys.has(row.sourceKey) && !rows.some((r) => r.sourceKey === row.sourceKey)) rows.push(row);
  };

  const hintedNow = new Set(after.hinted);
  const wasMatched = new Set(before.matched);
  const newKeys = after.matched.filter((k) => !wasMatched.has(k));
  for (const key of newKeys) {
    // 看过完整题解：关键步骤不再计经验；只看过思路：之后写出的按「借助提示」档计。
    if (reveal === 'full') continue;
    const hinted = hintedNow.has(key) || reveal === 'approach';
    add({
      sourceKey: keySource(ctx.problemId, key),
      kind: hinted ? 'key_hinted' : 'key_own',
      amount: hinted ? XP.keyHinted : XP.keyOwn,
      label: hinted ? '借助提示写出关键步骤' : '独立写出关键步骤',
    });
  }

  for (let n = 1; n <= 6; n += 1) {
    if (after.layerStatus[n] === 'done' && before.layerStatus[n] !== 'done') {
      add({ sourceKey: layerSource(ctx.problemId, n), kind: 'layer', amount: XP.layer, label: '完成一层' });
    }
  }

  const justFinished = after.done && !before.done;
  if (justFinished) add({ sourceKey: doneSource(ctx.problemId), kind: 'problem', amount: XP.problem, label: '完成一题' });

  const dailyRow: LedgerRow | null =
    rows.length > 0 && !ctx.dailyDone
      ? { sourceKey: dailySource(ctx.day), kind: 'daily', amount: XP.daily, label: '今天的第一步' }
      : null;

  // 每日目标按「自己写出的关键步骤数」算：本步新记经验的关键步骤数
  const keyRows = rows.filter((r) => r.kind === 'key_own' || r.kind === 'key_hinted').length;
  const goalReached = keyRows > 0 && ctx.keysTodayBefore < ctx.dailyGoal && ctx.keysTodayBefore + keyRows >= ctx.dailyGoal;

  const badges: BadgeId[] = [];
  const grant = (id: BadgeId, when: boolean): void => {
    if (when && !ctx.earnedBadges.has(id) && !badges.includes(id)) badges.push(id);
  };
  const progressed = rows.length > 0;
  const independent = after.reveal === 0 && after.overrides === 0 && after.hinted.length === 0 && reveal === 'none';
  grant('first_step', progressed);
  grant('own_write', rows.some((r) => r.kind === 'key_own'));
  grant('first_done', justFinished && ctx.kind !== 'redo');
  grant('no_hint_clear', justFinished && independent);
  grant('redo_success', justFinished && ctx.kind === 'redo');
  grant('unit_clear', justFinished && ctx.kind === 'main' && ctx.chapterCleared);
  grant('daily_goal', goalReached);
  grant('streak_3', progressed && ctx.streakIfActive >= 3);
  grant('streak_7', progressed && ctx.streakIfActive >= 7);
  grant('streak_30', progressed && ctx.streakIfActive >= 30);

  const xp = rows.reduce((sum, r) => sum + r.amount, 0) + (dailyRow?.amount ?? 0);
  return { rows, dailyRow, badges, xp, goalReached };
}

export { BADGES };
