import type { SelfStudyView } from '../api/types.ts';

type SelfStudyStudent = SelfStudyView['students'][number];

export interface SelfStudySummary {
  /** 做过自学题的同学数（做完、正在做或看过解答，任一不为 0） */
  studying: number;
  doneTotal: number;
  active: number;
  revealed: number;
  /** 某位同学在某个单元里做完几题 */
  doneIn: (student: SelfStudyStudent, unitId: string) => number;
}

/** 只汇总服务端给的数；不在浏览器里再算新的指标。 */
export function summarizeSelfStudy(view: SelfStudyView | null): SelfStudySummary {
  const students = view?.students ?? [];
  return {
    studying: students.filter((s) => s.doneTotal > 0 || s.active > 0 || s.revealed > 0).length,
    doneTotal: students.reduce((sum, s) => sum + s.doneTotal, 0),
    active: students.reduce((sum, s) => sum + s.active, 0),
    revealed: students.reduce((sum, s) => sum + s.revealed, 0),
    doneIn: (student, unitId) => student.byUnit.find((item) => item.unitId === unitId)?.done ?? 0,
  };
}
