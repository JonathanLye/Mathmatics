/**
 * 完成页「下一题」：学习路径上下一道没做完的题。路径和状态都来自服务端，这里只挑。
 * 优先当前单元里本题后面的题，再回头找前面漏下的；当前单元做完了，下一步看下一个单元。
 */
import type { PathItem, StudentPath } from '@/types/path'

/** 当前单元里的下一道；没有就是 null。 */
export function nextItemInUnit(items: readonly PathItem[], currentProblemId: string): string | null {
  const at = items.findIndex((item) => item.problemId === currentProblemId)
  const ordered = at === -1 ? items : [...items.slice(at + 1), ...items.slice(0, at)]
  return ordered.find((item) => item.state !== 'done' && item.problemId !== currentProblemId)?.problemId ?? null
}

/** 当前单元之后第一个没做完、没上锁的单元。 */
export function nextUnitId(path: StudentPath): string | null {
  const units = path.units
  const at = units.findIndex((unit) => unit.id === path.current?.id)
  return units.slice(at + 1).find((unit) => unit.state !== 'done' && !unit.locked)?.id ?? null
}
