/**
 * 轻提示：全局只有一条。PgToast 由 GlobalHost 挂在页面之外，任何页面、任何模块都能直接调用。
 */
import { reactive, readonly } from 'vue'

export type ToastTone = 'neutral' | 'ok' | 'warn'

export interface ToastAction {
  label: string
  run: () => void
}
interface ToastState {
  message: string
  tone: ToastTone
  action: ToastAction | null
}

export const TOAST_DEFAULT_MS = 2400
export const TOAST_ACTION_MS = 8000

const state = reactive<ToastState>({ message: '', tone: 'neutral', action: null })
let timer: ReturnType<typeof setTimeout> | null = null

function hide(): void {
  if (timer) clearTimeout(timer)
  timer = null
  state.message = ''
  state.action = null
}

function show(message: string, options: { tone?: ToastTone; duration?: number; action?: ToastAction } = {}): void {
  if (timer) clearTimeout(timer)
  state.message = message
  state.tone = options.tone ?? 'neutral'
  state.action = options.action ?? null
  // 带按钮的提示多留一会儿，够学生去点。
  timer = setTimeout(hide, options.duration ?? (options.action ? TOAST_ACTION_MS : TOAST_DEFAULT_MS))
}

export function useToast() {
  return { state: readonly(state), show, hide }
}
