/**
 * 学习进度（GET /student/progress）的页面间共用缓存：首页、右栏、我的、徽章页看到的是同一份。
 * 失败时 progress 保持上一次的值（没有就是 null），页面显示占位，不编数字。
 */
import { computed, readonly, ref } from 'vue'
import { fetchProgress } from '@/api/client'
import type { ProgressView } from '@/types/attempt'

const FRESH_MS = 20_000

const progress = ref<ProgressView | null>(null)
const loading = ref(false)
const failed = ref(false)
let loadedAt = 0
let inflight: Promise<void> | null = null

async function load(force = false): Promise<void> {
  if (!force && progress.value && Date.now() - loadedAt < FRESH_MS) return
  if (inflight) return inflight
  loading.value = true
  inflight = (async () => {
    try {
      progress.value = await fetchProgress()
      failed.value = false
      loadedAt = Date.now()
    } catch {
      failed.value = true
    } finally {
      loading.value = false
      inflight = null
    }
  })()
  return inflight
}

/** 退出登录：换个同学登录时不能看到上一位的数字。 */
export function resetProgress(): void {
  progress.value = null
  failed.value = false
  loadedAt = 0
}

export function useProgress() {
  return { progress: computed(() => progress.value), loading: readonly(loading), failed: readonly(failed), load }
}
