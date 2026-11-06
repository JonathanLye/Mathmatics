/**
 * 吉祥物小方的小状态机：idle → think → happy | oops | cheer → idle，反应结束后定时回到待机。
 * 状态转移是纯函数（mascotNext），composable 只负责定时；表情和动作的对应表也放在这里，页面不用记。
 */
import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import type { MascotExpr } from '@/components/ui/icons'
import type { MascotMotion } from '@/components/ui/uiLogic'

export type MascotState = 'idle' | 'think' | 'happy' | 'oops' | 'cheer' | 'sleepy'
export type MascotEvent = 'think' | 'happy' | 'oops' | 'cheer' | 'sleep' | 'idle'

/** 反应类状态停留多久后回到 idle（毫秒）。 */
export const MASCOT_RETURN_MS: Partial<Record<MascotState, number>> = { happy: 1800, oops: 2200, cheer: 2800 }

export const MASCOT_MOTION: Record<MascotState, MascotMotion[]> = {
  idle: ['breathe', 'blink'],
  think: ['think-tilt', 'blink'],
  happy: ['hop'],
  oops: ['droop'],
  cheer: ['cheer'],
  sleepy: ['breathe'],
}

/** 不合法的转移（比如 sleepy 直接 oops）留在原状态；idle 事件和 think 任何时候都能回。 */
export function mascotNext(state: MascotState, event: MascotEvent): MascotState {
  switch (event) {
    case 'idle':
      return 'idle'
    case 'think':
      return state === 'sleepy' ? state : 'think'
    case 'sleep':
      return state === 'idle' ? 'sleepy' : state
    default:
      return state === 'think' || state === 'idle' ? event : state
  }
}

export interface MascotHandle {
  state: Ref<MascotState>
  expr: ComputedRef<MascotExpr>
  motion: ComputedRef<MascotMotion[]>
  send: (event: MascotEvent) => void
}

export function useMascot(initial: MascotState = 'idle'): MascotHandle {
  const state = ref<MascotState>(initial)
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function send(event: MascotEvent): void {
    const next = mascotNext(state.value, event)
    if (next === state.value) return
    clear()
    state.value = next
    const wait = MASCOT_RETURN_MS[next]
    if (wait) timer = setTimeout(() => send('idle'), wait)
  }

  onUnmounted(clear)

  return {
    state,
    expr: computed(() => state.value),
    motion: computed(() => MASCOT_MOTION[state.value]),
    send,
  }
}
