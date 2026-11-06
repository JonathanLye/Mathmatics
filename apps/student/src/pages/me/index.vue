<script setup lang="ts">
/**
 * 我的：昵称、外观、音效/动效/震动、退出登录。
 * 成就和统计留给后续任务（占位用 PgEmpty，不假装有数据）；偏好现在只存在本机。
 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgDialog from '@/components/ui/PgDialog.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgListRow from '@/components/ui/PgListRow.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSwitch from '@/components/ui/PgSwitch.vue'
import { useTheme, type ThemeChoice } from '@/composables/useTheme'
import { studentName } from '@/copy'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'

const session = useSession()
const { theme, setTheme } = useTheme()
const { sound, motion, haptics } = useFeedbackPrefs()

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; testid: string }> = [
  { value: 'system', label: '跟随系统', testid: 'me-theme-system' },
  { value: 'light', label: '浅色', testid: 'me-theme-light' },
  { value: 'dark', label: '深色', testid: 'me-theme-dark' },
]

const name = computed(() => studentName(session.me.value?.displayName))
const confirmingLogout = ref(false)
const loggingOut = ref(false)

onShow(() => {
  if (!session.me.value) void session.refreshMe()
})

async function logout(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await session.logout()
  } catch {
    /* 接口失败也清掉本地登录态（session.logout 的 finally），回登录页 */
  } finally {
    loggingOut.value = false
    confirmingLogout.value = false
    uni.reLaunch({ url: '/pages/login/index' })
  }
}
</script>

<template>
  <AppShell active="me">
    <view class="pg-me" data-testid="me-page">
      <PgCard class="pg-me__profile">
        <PgMascot expr="happy" :motion="['breathe', 'blink']" :size="72" />
        <text class="pg-me__name" data-testid="me-name">{{ name }}</text>
      </PgCard>

      <text class="pg-me__section">外观</text>
      <PgSegmented class="pg-me__theme" :model-value="theme" :options="THEME_OPTIONS" label="外观" @update:model-value="setTheme" />

      <text class="pg-me__section">手感</text>
      <PgCard flush>
        <PgListRow title="音效" sub="答对、提示和庆祝时的短音" icon="sound">
          <template #right><PgSwitch v-model="sound" label="音效" data-testid="me-pref-sound" /></template>
        </PgListRow>
        <PgListRow title="动效" sub="按钮回弹、页面过渡和撒花" icon="motion">
          <template #right><PgSwitch v-model="motion" label="动效" data-testid="me-pref-motion" /></template>
        </PgListRow>
        <PgListRow title="震动" sub="支持的手机上轻轻震一下" icon="vibrate">
          <template #right><PgSwitch v-model="haptics" label="震动" data-testid="me-pref-haptics" /></template>
        </PgListRow>
      </PgCard>

      <PgEmpty title="成就还在路上" body="等你多写几道证明，这里会攒起你的记录。" expr="sleepy" :motion="null" :size="88" />

      <PgButton variant="secondary" block data-testid="me-logout" @tap="confirmingLogout = true">退出登录</PgButton>
    </view>

    <PgDialog
      v-model:open="confirmingLogout"
      title="退出登录？"
      body="写到一半的内容已经保存，下次登录还能接着写。"
      confirm-text="退出"
      danger
      :busy="loggingOut"
      confirm-testid="me-logout-confirm"
      cancel-testid="me-logout-cancel"
      @confirm="logout"
    />
  </AppShell>
</template>

<style scoped>
.pg-me { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-me__profile { display: flex; align-items: center; gap: var(--sp-3); }
.pg-me__name { min-width: 0; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); overflow-wrap: anywhere; }
.pg-me__section { margin-top: var(--sp-3); color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
</style>
