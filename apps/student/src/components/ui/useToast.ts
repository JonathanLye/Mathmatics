/**
 * 轻提示：全局只有一条。PgToast 由 GlobalHost 挂在页面之外，任何页面、任何模块都能直接调用。
 */
import { reactive, readonly } from 'vue'

export type ToastTone = 'neutral' | 'ok' | 'warn'

interface ToastState {
  message: string
  tone: ToastTone
}

export const TOAST_DEFAULT_MS = 2400

const state = reactive<ToastState>({ message: '', tone: 'neutral' })
let timer: ReturnType<typeof setTimeout> | null = null

function hide(): void {
  if (timer) clearTimeout(timer)
  timer = null
  state.message = ''
}

function show(message: string, options: { tone?: ToastTone; duration?: number } = {}): void {
  if (timer) clearTimeout(timer)
  state.message = message
  state.tone = options.tone ?? 'neutral'
  timer = setTimeout(hide, options.duration ?? TOAST_DEFAULT_MS)
}

export function useToast() {
  return { state: readonly(state), show, hide }
}
