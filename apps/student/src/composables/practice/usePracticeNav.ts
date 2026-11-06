/** 做题页的去向：返回、回首页、证明本、层列表，以及完成页主按钮要去哪里。 */
import { computed, ref } from 'vue'
import { getStudentPath, startPathItem } from '@/api/client'
import { nextItemInUnit, nextUnitId } from '@/components/practice/nextProblem'
import { frontierLayer } from '@/components/practice/practiceProgress'
import { setPendingAttempt } from '@/stores/attempt'
import type { AttemptState, LayerId } from '@/types/attempt'
import type { AttemptSession } from './useAttemptSession'

export type PracticeOrigin = 'mistakes' | 'redo' | null

async function nextPathAttempt(currentProblemId: string): Promise<AttemptState | null> {
  const path = await getStudentPath()
  let problemId = nextItemInUnit(path.current?.items ?? [], currentProblemId)
  if (!problemId) {
    const unitId = nextUnitId(path)
    if (unitId) problemId = nextItemInUnit((await getStudentPath(unitId)).current?.items ?? [], currentProblemId)
  }
  return problemId ? startPathItem(problemId) : null
}

export function usePracticeNav(session: Pick<AttemptSession, 'state' | 'currentLayer' | 'isCompleted' | 'isTransferAttempt' | 'goToLayer'>) {
  /** 从错题本、证明本进来的重做：完成后回到那里。 */
  const origin = ref<PracticeOrigin>(null)
  const nextBusy = ref(false)

  function setOrigin(from: unknown): void {
    origin.value = from === 'mistakes' ? 'mistakes' : from === 'redo' ? 'redo' : null
  }

  function backHome(): void {
    uni.redirectTo({ url: '/pages/home/index' })
  }

  /** 关闭：回到上一页；直接打开链接时没有上一页，回到路径。 */
  function handleBack(): void {
    if (getCurrentPages().length > 1) uni.navigateBack()
    else uni.reLaunch({ url: '/pages/home/index' })
  }

  function goProofbook(): void {
    uni.navigateTo({ url: '/pages/proofbook/index' })
  }

  /** 看讲评：讲评在证明本的这道题详情里。 */
  /** 完成页主按钮：回错题本、回证明本，或者学习路径上的下一题；没有下一题或取不到就回首页。 */
  async function goNext(): Promise<void> {
    if (origin.value === 'mistakes') {
      uni.redirectTo({ url: '/pages/mistakes/index' })
      return
    }
    if (origin.value === 'redo') {
      uni.redirectTo({ url: '/pages/proofbook/index' })
      return
    }
    nextBusy.value = true
    try {
      const next = await nextPathAttempt(session.state.value.problem.problemId)
      if (!next) {
        backHome()
        return
      }
      setPendingAttempt(next)
      uni.redirectTo({ url: '/pages/practice/index?attemptId=' + encodeURIComponent(next.attemptId) })
    } catch {
      backHome()
    } finally {
      nextBusy.value = false
    }
  }

  /** 层列表：点已完成的层回去看，点还在做的层回来（POST /layers/{layer}/enter）。 */
  const layersOpen = ref(false)
  const frontier = computed(() => frontierLayer(session.state.value.layers))
  /** 回看已完成的层：显示回去的入口，藏掉「跳过」（服务端不让跳已完成的层）。 */
  const reviewing = computed(
    () => !session.isCompleted.value && !session.isTransferAttempt.value && Boolean(frontier.value) && session.currentLayer.value !== frontier.value,
  )
  function selectLayer(layer: LayerId): void {
    layersOpen.value = false
    void session.goToLayer(layer)
  }

  return { layersOpen, frontier, reviewing, selectLayer, origin, nextBusy, setOrigin, backHome, handleBack, goProofbook, goNext }
}
