/**
 * 证明轨道上哪些行写到了关键步骤（节点染绿）。只影响显示：判定都在服务端。
 * 按作答存在本机，刷新后还在；测验模式不记。
 */
import { computed, ref, watch } from 'vue'
import { keyLineLostOnTransition, keyLineOfTransition } from '@/components/practice/proofRail'
import type { AttemptSession } from './useAttemptSession'

const STORAGE_PREFIX = 'pg.keylines.'

function readStored(attemptId: string): string[] {
  try {
    const raw = uni.getStorageSync(STORAGE_PREFIX + attemptId)
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeStored(attemptId: string, ids: readonly string[]): void {
  try {
    uni.setStorageSync(STORAGE_PREFIX + attemptId, [...ids])
  } catch {
    /* 存不下只是回到中性，不影响作答 */
  }
}

export function useKeyLines(session: Pick<AttemptSession, 'state' | 'onTransition'>) {
  const ids = ref<string[]>([])

  watch(
    () => session.state.value.attemptId,
    (attemptId) => {
      ids.value = attemptId ? readStored(attemptId) : []
    },
    { immediate: true },
  )

  session.onTransition((prev, next) => {
    const lost = keyLineLostOnTransition(prev, next)
    if (lost && ids.value.includes(lost)) {
      ids.value = ids.value.filter((id) => id !== lost)
      writeStored(next.attemptId, ids.value)
    }
    const lineId = keyLineOfTransition(prev, next)
    if (!lineId || ids.value.includes(lineId)) return
    ids.value = [...ids.value, lineId]
    writeStored(next.attemptId, ids.value)
  })

  /** 演示数据里的行可能自带 keys；真实接口不下发，只有本机记录。 */
  const matchedLineIds = computed(() => {
    if (session.state.value.mode === 'test') return []
    const fromState = (session.state.value.steps?.lines ?? []).filter((line) => (line.keys?.length ?? 0) > 0).map((line) => line.lineId)
    return [...new Set([...ids.value, ...fromState])]
  })

  return { matchedLineIds }
}
