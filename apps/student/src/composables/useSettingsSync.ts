/**
 * 账号里的设置（GET/PATCH /student/settings）和本机偏好的同步。
 * - 进主标签页时拉一次：账号里的外观、手感覆盖本机（换设备也一样）；本机 localStorage 只当缓存，首屏不闪。
 * - 改设置时先生效，再写账号；写失败提示一句，这台设备上仍然生效。
 * - mock 模式没有账号：不拿默认值去盖本机的选择。
 * - 没签同意书时接口会拒绝：什么都不做，签完回到主标签页会再拉。
 */
import { readonly, ref } from 'vue'
import { fetchSettings, isMockMode, updateSettings } from '@/api/client'
import { useToast } from '@/components/ui/useToast'
import { ME_COPY } from '@/copy'
import { setTheme, type ThemeChoice } from '@/composables/useTheme'
import { setFeedbackPref, type FeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'
import type { SettingsPatch, SettingsView } from '@/types/attempt'

const settings = ref<SettingsView | null>(null)
let syncedFor: string | null = null
let inflight: Promise<void> | null = null

function applyToDevice(next: SettingsView): void {
  setTheme(next.theme)
  setFeedbackPref('sound', next.sound)
  setFeedbackPref('motion', next.motion)
  setFeedbackPref('haptics', next.haptics)
}

/** 这位同学在这次打开里只拉一次。换人登录（userId 变了）会重新拉。 */
export function ensureSettingsLoaded(force = false): Promise<void> {
  const who = useSession().me.value?.userId ?? 'anonymous'
  if (!force && syncedFor === who && settings.value) return Promise.resolve()
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const next = await fetchSettings()
      settings.value = next
      syncedFor = who
      if (!isMockMode()) applyToDevice(next)
    } catch {
      // 还没签同意书、断网：不影响使用，本机偏好继续生效。
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 写账号。返回最新设置；失败抛错由调用方决定怎么说（昵称要显示服务端原因）。 */
export async function patchSettings(patch: SettingsPatch): Promise<SettingsView> {
  const next = await updateSettings(patch)
  settings.value = next
  return next
}

/** 开关类的改动：不等接口，失败轻提示。 */
function saveQuietly(patch: SettingsPatch): Promise<void> {
  return patchSettings(patch).then(
    () => undefined,
    () => {
      useToast().show(ME_COPY.saveFailed, { tone: 'warn' })
    },
  )
}

export function saveTheme(choice: ThemeChoice): void {
  setTheme(choice)
  void saveQuietly({ theme: choice })
}

export function saveFeedbackPref(key: keyof FeedbackPrefs, value: boolean): void {
  setFeedbackPref(key, value)
  void saveQuietly({ [key]: value })
}

/** 写完才结束：改每日目标后要等账号存好，再重新取进度。 */
export function saveChoice(patch: Pick<SettingsPatch, 'dailyGoal' | 'defaultInput'>): Promise<void> {
  if (settings.value) settings.value = { ...settings.value, ...patch }
  return saveQuietly(patch)
}

/** 退出登录：下一位同学重新拉。 */
export function resetSettingsSync(): void {
  settings.value = null
  syncedFor = null
}

export function useSettings() {
  return { settings: readonly(settings), ensureSettingsLoaded, patchSettings, saveTheme, saveFeedbackPref, saveChoice }
}
