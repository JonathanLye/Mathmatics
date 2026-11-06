/**
 * 教师首次使用清单：建班 → 导名单 → 发邀请码 → 看看板。
 * 能从数据判断的从数据判断（有班级、名单里有人、有人用邀请码登录认领过）；
 * “看看板”没有数据可查，用本机标记：点过清单上的“打开看板”就算。
 * 本机标记按教师分开存（教师端和学生端同一个域名，键名带前缀，不会混）。
 */
import type { ClassSummary } from '../api/types.ts';

export type FirstRunKey = 'class' | 'roster' | 'invite' | 'board';

export interface FirstRunLocal {
  dismissed: boolean;
  /** 点过“复制邀请码”（还没有学生登录认领之前，这是“发出去了”的唯一信号）。 */
  invite: boolean;
  board: boolean;
}

export interface FirstRunItem {
  key: FirstRunKey;
  title: string;
  hint: string;
  done: boolean;
}

export const EMPTY_LOCAL: FirstRunLocal = { dismissed: false, invite: false, board: false };

export function firstRunStorageKey(userId: string | null | undefined): string {
  return `pg.teacher.firstrun.v1.${userId && userId !== '' ? userId : 'anon'}`;
}

export function parseFirstRunLocal(raw: string | null | undefined): FirstRunLocal {
  if (!raw) return { ...EMPTY_LOCAL };
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof FirstRunLocal, unknown>>;
    return {
      dismissed: value.dismissed === true,
      invite: value.invite === true,
      board: value.board === true,
    };
  } catch {
    return { ...EMPTY_LOCAL };
  }
}

type ClassCounts = Pick<ClassSummary, 'students' | 'claimed'>;

export function buildChecklist(classes: readonly ClassCounts[], local: FirstRunLocal): FirstRunItem[] {
  const students = classes.reduce((sum, c) => sum + (c.students ?? 0), 0);
  const claimed = classes.reduce((sum, c) => sum + (c.claimed ?? 0), 0);
  return [
    { key: 'class', title: '建班', hint: '起个班级名，系统给你一个邀请码', done: classes.length > 0 },
    { key: 'roster', title: '导名单', hint: '进入班级，在“名单”里粘贴或导入学号', done: students > 0 },
    { key: 'invite', title: '发邀请码', hint: '把邀请码发给学生，他们用学号登录激活', done: claimed > 0 || local.invite },
    { key: 'board', title: '看看板', hint: '学生开始写以后，实时看板会显示每个人的进度', done: local.board },
  ];
}

/** 第一件没做完的事；全做完返回 null。 */
export function nextFirstRunStep(items: readonly FirstRunItem[]): FirstRunItem | null {
  return items.find((item) => !item.done) ?? null;
}

export function firstRunProgress(items: readonly FirstRunItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.done).length, total: items.length };
}

/** 清单要不要显示：没收起，或者还没有班级（空状态永远带下一步）。 */
export function showFirstRun(items: readonly FirstRunItem[], local: FirstRunLocal): boolean {
  if (!items[0]?.done) return true;
  return !local.dismissed;
}
