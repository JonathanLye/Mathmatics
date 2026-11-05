/**
 * 响应式读取主题 CSS token（深色模式修复，D1/D2；Refs #37）。
 *
 * - H5：onMounted 读 getComputedStyle（拿当前主题计算值），并监听 prefers-color-scheme 变化；
 * - Node 单测/小程序：无 DOM，回退 fallback（tokens.css 浅色值），不报错；
 * - 只读 token，不写 DOM；不在 view 模板外做任何业务判断。
 */
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

import { readCssToken } from '@/utils/themeTokens'

export function useThemeToken(name: string, fallback: string): Ref<string> {
  const value = ref(readCssToken(name, fallback))
  let media: MediaQueryList | null = null

  const sync = () => {
    value.value = readCssToken(name, fallback)
  }

  onMounted(() => {
    sync()
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    media = window.matchMedia('(prefers-color-scheme: dark)')
    if (typeof media.addEventListener === 'function') media.addEventListener('change', sync)
    // 兼容旧 WebView（部分微信内核只有 addListener）。
    else if (typeof media.addListener === 'function') media.addListener(sync)
  })

  onUnmounted(() => {
    if (!media) return
    if (typeof media.removeEventListener === 'function') media.removeEventListener('change', sync)
    else if (typeof media.removeListener === 'function') media.removeListener(sync)
    media = null
  })

  return value
}
