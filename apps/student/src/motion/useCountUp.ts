/**
 * 数字滚动：值变化时从旧值滚到新值。动效被关或没有 requestAnimationFrame 时直接跳到终值。
 */
import { onUnmounted, ref, watch, type Ref, type WatchSource } from 'vue'
import { feedbackAllowed } from './useFeedbackPrefs'

export const COUNT_UP_MS = 700

/** cubic ease-out：快起慢收。 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - (1 - clamped) ** 3
}

/** 第 elapsed 毫秒时该显示的整数；到点后精确等于 to。 */
export function countUpValue(from: number, to: number, elapsed: number, duration = COUNT_UP_MS): number {
  if (duration <= 0 || elapsed >= duration) return to
  return Math.round(from + (to - from) * easeOutCubic(elapsed / duration))
}

export function useCountUp(source: WatchSource<number>, options: { duration?: number; from?: number } = {}): Ref<number> {
  const display = ref(options.from ?? 0)
  const duration = options.duration ?? COUNT_UP_MS
  let frame: number | null = null

  const cancel = () => {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    frame = null
  }

  watch(
    source,
    (to) => {
      cancel()
      if (typeof requestAnimationFrame !== 'function' || !feedbackAllowed('motion')) {
        display.value = to
        return
      }
      const from = display.value
      const startedAt = performance.now()
      const tick = (now: number) => {
        display.value = countUpValue(from, to, now - startedAt, duration)
        frame = display.value === to ? null : requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    },
    { immediate: true },
  )

  onUnmounted(cancel)
  return display
}
