// 徽章目录（放在代码里；库里只记谁在什么时候得到了哪个）。
export const BADGES = [
  { id: 'first_step', title: '第一步', desc: '第一次写出有进展的一步', target: 1 },
  { id: 'own_write', title: '独立写出', desc: '第一次不靠提示写出一个关键步骤', target: 1 },
  { id: 'first_done', title: '证完一道', desc: '第一次完整证完一道题', target: 1 },
  { id: 'streak_3', title: '连续 3 天', desc: '连续 3 天都有实质进展', target: 3 },
  { id: 'streak_7', title: '连续 7 天', desc: '连续 7 天都有实质进展', target: 7 },
  { id: 'streak_30', title: '连续 30 天', desc: '连续 30 天都有实质进展', target: 30 },
  { id: 'unit_clear', title: '单元通关', desc: '一个单元布置的题都证完了', target: 1 },
  { id: 'no_hint_clear', title: '无提示通关', desc: '不用任何提示证完一道题', target: 1 },
  { id: 'redo_success', title: '重做成功', desc: '把做过的题重新独立证了一遍', target: 1 },
  { id: 'daily_goal', title: '今日目标达成', desc: '一天内写出的关键步骤达到每日目标', target: 1 },
] as const;

export type BadgeId = (typeof BADGES)[number]['id'];

export const BADGE_IDS: readonly string[] = BADGES.map((b) => b.id);

export function badgeById(id: string): (typeof BADGES)[number] | undefined {
  return BADGES.find((b) => b.id === id);
}
