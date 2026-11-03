/**
 * 三档布局（02 §3）：mobile <600 / tablet 600–1023 / desktop ≥1024。
 * H5 用 window.innerWidth + resize；小程序端用 uni.getSystemInfoSync 的 windowWidth（#ifdef）。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

export type LayoutMode = 'mobile' | 'tablet' | 'desktop'

const width = ref(390)

function readWidth(): number {
  // #ifdef H5
  if (typeof window !== 'undefined') return window.innerWidth
  // #endif
  try {
    const info = uni.getSystemInfoSync()
    return info.windowWidth || 390
  } catch {
    return 390
  }
}

export function layoutModeOf(px: number): LayoutMode {
  return px >= 1024 ? 'desktop' : px >= 600 ? 'tablet' : 'mobile'
}

export function useViewport() {
  const mode = computed<LayoutMode>(() => layoutModeOf(width.value))
  const isMobile = computed(() => mode.value === 'mobile')

  let onResize: (() => void) | null = null
  onMounted(() => {
    width.value = readWidth()
    // #ifdef H5
    if (typeof window !== 'undefined') {
      onResize = () => { width.value = readWidth() }
      window.addEventListener('resize', onResize)
    }
    // #endif
  })
  onUnmounted(() => {
    // #ifdef H5
    if (onResize && typeof window !== 'undefined') window.removeEventListener('resize', onResize)
    // #endif
  })

  return { width, mode, isMobile }
}
