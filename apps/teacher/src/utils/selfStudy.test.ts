import { describe, expect, it } from 'vitest';

import type { SelfStudyView } from '../api/types.ts';
import { summarizeSelfStudy } from './selfStudy.ts';

const view: SelfStudyView = {
  units: [
    { id: 'u1', chapterNo: 2, unitNo: 1, title: '数列极限入门', total: 3 },
    { id: 'u2', chapterNo: 12, unitNo: 1, title: '交错级数', total: 2 },
  ],
  students: [
    { anonCode: 'S-A', displayName: '林知远', doneTotal: 2, active: 1, revealed: 1, lastActiveAt: null, byUnit: [{ unitId: 'u1', done: 2 }] },
    { anonCode: 'S-B', displayName: null, doneTotal: 0, active: 0, revealed: 0, lastActiveAt: null, byUnit: [] },
    { anonCode: 'S-C', displayName: '周明哲', doneTotal: 0, active: 1, revealed: 0, lastActiveAt: '2026-11-06T10:00:00Z', byUnit: [{ unitId: 'u2', done: 0 }] },
  ],
};

describe('自学进度汇总', () => {
  it('只汇总服务端给的数；什么都没做的同学不算“做过自学题”', () => {
    const s = summarizeSelfStudy(view);
    expect(s).toMatchObject({ studying: 2, doneTotal: 2, active: 2, revealed: 1 });
  });

  it('doneIn：单元里没有记录就是 0', () => {
    const s = summarizeSelfStudy(view);
    const [a, b] = view.students;
    expect(s.doneIn(a!, 'u1')).toBe(2);
    expect(s.doneIn(a!, 'u2')).toBe(0);
    expect(s.doneIn(b!, 'u1')).toBe(0);
  });

  it('空数据不报错', () => {
    expect(summarizeSelfStudy(null)).toMatchObject({ studying: 0, doneTotal: 0, active: 0, revealed: 0 });
  });
});
