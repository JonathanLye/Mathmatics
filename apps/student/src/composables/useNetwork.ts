/**
 * 网络状态 composable（#27 离线提示条）：online/offline 事件 + navigator.onLine 初始值。
 * 单独维护 UI 状态；诚信 SDK 自己也监听 online/offline 并上报 integ.network。
 */
import { readonly, ref } from 'vue'

const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
const changedAt = ref<number | null>(null)
let attached = false

function attach(): void {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('online', () => {
    online.value = true
    changedAt.value = Date.now()
  })
  window.addEventListener('offline', () => {
    online.value = false
    changedAt.value = Date.now()
  })
}

export function useNetwork(): { online: Readonly<typeof online>; changedAt: Readonly<typeof changedAt> } {
  attach()
  return { online: readonly(online), changedAt: readonly(changedAt) }
}

/** 单测/非组件环境用。 */
export function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
