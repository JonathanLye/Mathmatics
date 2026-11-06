/**
 * 证明轨道的纯逻辑。
 *
 * 轨道上的节点要不要染绿：契约有意不下发每行的判断字段（attempt-views.test.ts 锁定），所以由前端在
 * 关键步骤数增加的那一刻记下是哪一行（比较前后两份 state），按作答存在本机。换设备后节点回到中性，不影响任何判定。
 */
import type { AttemptState, ProofLine } from '@/types/attempt'

/** 这次 state 变化让关键步骤多了一个时，算到哪一行上；否则 null。测验模式不记。 */
export function keyLineOfTransition(prev: AttemptState, next: AttemptState): string | null {
  if (next.mode === 'test' || next.integrity?.mode === 'test') return null
  if (!prev.attemptId || prev.attemptId !== next.attemptId) return null
  if (next.budget.keysOwn <= prev.budget.keysOwn) return null
  const before = new Map((prev.steps?.lines ?? []).map((line) => [line.lineId, line]))
  const lines = next.steps?.lines ?? []
  const added = lines.filter((line) => !before.has(line.lineId)).at(-1)
  if (added) return added.lineId
  const edited = lines.find((line) => {
    const old = before.get(line.lineId)
    return old && (old.statement !== line.statement || (old.justification ?? '') !== (line.justification ?? ''))
  })
  return edited?.lineId ?? null
}

/** 依据的候选：状态里没有现成建议，就给前面用过的依据和「由第 n 行」。只是省打字，不代表对错。 */
export function justificationCandidates(lines: readonly ProofLine[], limit = 4): string[] {
  const out: string[] = []
  const add = (text: string | null | undefined): void => {
    const value = (text ?? '').trim()
    if (value && !out.includes(value)) out.push(value)
  }
  const last = lines.at(-1)
  if (last) add('由第 ' + last.n + ' 行')
  for (const line of [...lines].reverse()) add(line.justification)
  return out.slice(0, limit)
}
