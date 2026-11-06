import { describe, expect, it } from 'vitest';

import {
  buildChecklist,
  EMPTY_LOCAL,
  firstRunProgress,
  firstRunStorageKey,
  nextFirstRunStep,
  parseFirstRunLocal,
  showFirstRun,
} from './firstRun.ts';

describe('教师首次使用清单', () => {
  it('没有班级：第一步是建班，全部未完成', () => {
    const items = buildChecklist([], EMPTY_LOCAL);
    expect(items.map((i) => i.key)).toEqual(['class', 'roster', 'invite', 'board']);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(nextFirstRunStep(items)?.key).toBe('class');
  });

  it('状态从数据推出来：有班级 → 名单里有人 → 有人认领', () => {
    expect(nextFirstRunStep(buildChecklist([{ students: 0, claimed: 0 }], EMPTY_LOCAL))?.key).toBe('roster');
    expect(nextFirstRunStep(buildChecklist([{ students: 30, claimed: 0 }], EMPTY_LOCAL))?.key).toBe('invite');
    expect(nextFirstRunStep(buildChecklist([{ students: 30, claimed: 4 }], EMPTY_LOCAL))?.key).toBe('board');
  });

  it('点过“复制邀请码”也算发了邀请码；看板只靠本机标记', () => {
    const items = buildChecklist([{ students: 30, claimed: 0 }], { ...EMPTY_LOCAL, invite: true });
    expect(items.find((i) => i.key === 'invite')?.done).toBe(true);
    expect(nextFirstRunStep(items)?.key).toBe('board');
    const all = buildChecklist([{ students: 30, claimed: 4 }], { ...EMPTY_LOCAL, board: true });
    expect(nextFirstRunStep(all)).toBeNull();
    expect(firstRunProgress(all)).toEqual({ done: 4, total: 4 });
  });

  it('多个班级合起来算；缺 claimed 当 0', () => {
    const items = buildChecklist([{ students: 0 }, { students: 12, claimed: 1 }], EMPTY_LOCAL);
    expect(items.find((i) => i.key === 'roster')?.done).toBe(true);
    expect(items.find((i) => i.key === 'invite')?.done).toBe(true);
  });

  it('收起后不再显示；但没有班级时永远显示（空状态要有下一步）', () => {
    const dismissed = { ...EMPTY_LOCAL, dismissed: true };
    expect(showFirstRun(buildChecklist([{ students: 1, claimed: 0 }], EMPTY_LOCAL), EMPTY_LOCAL)).toBe(true);
    expect(showFirstRun(buildChecklist([{ students: 1, claimed: 0 }], dismissed), dismissed)).toBe(false);
    expect(showFirstRun(buildChecklist([], dismissed), dismissed)).toBe(true);
  });

  it('本机标记：按教师分开，坏数据回到空', () => {
    expect(firstRunStorageKey('a')).not.toBe(firstRunStorageKey('b'));
    expect(firstRunStorageKey(null)).toContain('anon');
    expect(parseFirstRunLocal('{"dismissed":true,"board":true,"x":1}')).toEqual({ dismissed: true, invite: false, board: true });
    expect(parseFirstRunLocal('{oops')).toEqual(EMPTY_LOCAL);
    expect(parseFirstRunLocal(null)).toEqual(EMPTY_LOCAL);
  });
});
