/**
 * 证明行列表的纯逻辑（issue #12；PR #90 复审第 5 条要求抽成纯函数进 CI 单测）。
 *
 * 只做渲染分组，不做任何判定：
 * - 批注按 note.lineId 精确挂载，保持服务端下发顺序；
 * - lineId 为空或对应行已不在 state 里的批注 → 列表末尾（与 components/README.md 一致）；
 * - 行号取 max(n)+1：契约有软删 deleteLine，行号会不连续，不能用数组长度 + 1。
 *
 * 为什么单独成文件：vitest（node 环境）可以直接测，不依赖 DOM / Vue 运行时；
 * .github/workflows/ci.yml 的 workspace job 会跑 pnpm test，这些用例自动进 CI。
 */
import type { Note, ProofLine } from '@/types/attempt'

/** note.lineId → 该行下方的批注（保持服务端下发顺序；lineId 为空的批注不进 map）。 */
export function groupNotesByLine(notes: readonly Note[]): Map<string, Note[]> {
  const map = new Map<string, Note[]>()
  for (const note of notes) {
    if (!note.lineId) continue
    const list = map.get(note.lineId)
    if (list) list.push(note)
    else map.set(note.lineId, [note])
  }
  return map
}

/** 找不到对应行（lineId 为空或该行已不在 state 里）的批注：按契约挂在列表末尾。 */
export function selectTailNotes(lines: readonly ProofLine[], notes: readonly Note[]): Note[] {
  const lineIds = new Set(lines.map((line) => line.lineId))
  return notes.filter((note) => !note.lineId || !lineIds.has(note.lineId))
}

/** 同一行下方的批注（没有则空数组，模板可直接 v-for）。 */
export function notesForLine(notesByLine: ReadonlyMap<string, Note[]>, lineId: string): Note[] {
  return notesByLine.get(lineId) ?? []
}

/** 下一个行号 = max(已渲染行的 n) + 1；没有行时是 1（服务端 n 从 1 开始）。 */
export function nextLineNoOf(lines: readonly ProofLine[]): number {
  return lines.reduce((max, line) => Math.max(max, line.n), 0) + 1
}
