/**
 * 分步微课（02 §4.9）的开关：第 1 层「看不懂」，以及卡住时的出路都从这里打开。
 * 内容由服务端下发，只保存在内存里渲染。第 2 层「看通用骨架」是服务端状态，不走微课。
 */
import { ref } from 'vue'
import { checkLesson } from '@/api/client'
import { useToast } from '@/components/ui/useToast'
import type { LessonView } from '@/types/attempt'
import type { AttemptSession } from './useAttemptSession'

export function useLessonPanel(session: Pick<AttemptSession, 'state' | 'currentLayer' | 'loadLesson' | 'showFrameTemplate'>) {
  const toast = useToast()
  const microOpen = ref(false)
  const microLesson = ref<LessonView | null>(null)

  async function openLesson(): Promise<void> {
    const lesson = await session.loadLesson()
    if (!lesson) {
      toast.show('讲解暂时打不开，稍后再试')
      return
    }
    microLesson.value = lesson
    microOpen.value = true
  }

  async function handleLesson(): Promise<void> {
    if (session.currentLayer.value === 'L2') await session.showFrameTemplate()
    else await openLesson()
  }

  async function checkMicro(stepId: string, choice: number) {
    const lesson = microLesson.value
    if (!lesson) return null
    return checkLesson(session.state.value, lesson.conceptId, stepId, choice)
  }

  return { microOpen, microLesson, openLesson, handleLesson, checkMicro }
}
