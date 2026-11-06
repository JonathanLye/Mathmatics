<script setup lang="ts">
/**
 * 我的：资料卡（昵称可改、班级、学习天数/经验/徽章）、徽章入口、学习设置、外观、手感、更多、退出。
 * 设置都存到账号（GET/PATCH /student/settings），换设备也一样；写失败时本机仍生效并提示一句。
 * 数字只来自 GET /student/progress，拿不到时说一句，不编数字。
 */
import { computed, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import { nicknameError, goalChoices, NICKNAME_MAX } from '@/components/me/meLogic'
import ReplayOnboarding from '@/components/onboarding/ReplayOnboarding.vue'
import { applyApiOverride } from '@/components/path/openPractice'
import { badgeIcon, earnedBadges } from '@/components/progressLogic'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgDialog from '@/components/ui/PgDialog.vue'
import PgField from '@/components/ui/PgField.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgListRow from '@/components/ui/PgListRow.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgSegmented from '@/components/ui/PgSegmented.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import PgSwitch from '@/components/ui/PgSwitch.vue'
import { useToast } from '@/components/ui/useToast'
import { resetProgress, useProgress } from '@/composables/useProgress'
import { ensureSettingsLoaded, patchSettings, resetSettingsSync, saveChoice, saveFeedbackPref, saveTheme, useSettings } from '@/composables/useSettingsSync'
import { useTheme, type ThemeChoice } from '@/composables/useTheme'
import { BADGE_COPY, ME_COPY, PROGRESS_COPY, studentName } from '@/copy'
import { errorMessage } from '@/api/client'
import type { FeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { useSession } from '@/stores/session'
import type { SettingsView } from '@/types/attempt'

const session = useSession()
const toast = useToast()
const { theme } = useTheme()
const { sound, motion, haptics } = useFeedbackPrefs()
const { settings } = useSettings()
const { progress, loading: progressLoading, failed: progressFailed, load: loadProgress } = useProgress()

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; testid: string }> = [
  { value: 'system', label: '跟随系统', testid: 'me-theme-system' },
  { value: 'light', label: '浅色', testid: 'me-theme-light' },
  { value: 'dark', label: '深色', testid: 'me-theme-dark' },
]
const INPUT_OPTIONS: ReadonlyArray<{ value: SettingsView['defaultInput']; label: string; testid: string }> = [
  { value: 'hand', label: ME_COPY.inputHand, testid: 'me-input-hand' },
  { value: 'keyboard', label: ME_COPY.inputKeyboard, testid: 'me-input-keyboard' },
  { value: 'photo', label: ME_COPY.inputPhoto, testid: 'me-input-photo' },
]

const name = computed(() => studentName(settings.value?.nickname ?? session.me.value?.displayName))
const classNames = computed(() => (session.me.value?.classes ?? []).map((entry) => entry.name))
const goal = computed(() => settings.value?.dailyGoal ?? progress.value?.dailyGoal ?? 3)
const goalOptions = computed(() =>
  goalChoices(goal.value).map((value) => ({ value: String(value), label: String(value), testid: 'me-goal-' + value })),
)
const defaultInput = computed(() => settings.value?.defaultInput ?? 'hand')
const badges = computed(() => progress.value?.badges ?? [])
const earned = computed(() => earnedBadges(badges.value))
/** 入口上放几枚：拿到的排前面，填不满就露几枚没拿到的。 */
const shelf = computed(() => {
  const locked = badges.value.filter((badge) => !badge.earnedAt)
  return [...earned.value, ...locked].slice(0, 5)
})

const confirmingLogout = ref(false)
const loggingOut = ref(false)

const editingName = ref(false)
const nameDraft = ref('')
const nameBusy = ref(false)
const nameMessage = ref('')

onLoad((q) => {
  applyApiOverride(q)
})

onShow(() => {
  if (!session.me.value) void session.refreshMe()
  void ensureSettingsLoaded()
  void loadProgress(true)
})

watch(editingName, (open) => {
  if (open) {
    nameDraft.value = settings.value?.nickname ?? session.me.value?.displayName ?? ''
    nameMessage.value = ''
  }
})

function goPage(path: string): void {
  uni.navigateTo({ url: path })
}

function pickGoal(value: string): void {
  // 进度里的目标跟着账号走：存好再取一次，右栏和首页马上更新。
  void saveChoice({ dailyGoal: Number(value) }).then(() => loadProgress(true))
}

function pickInput(value: SettingsView['defaultInput']): void {
  void saveChoice({ defaultInput: value })
}

function togglePref(key: keyof FeedbackPrefs, value: boolean): void {
  saveFeedbackPref(key, value)
}

async function saveName(): Promise<void> {
  if (nameBusy.value) return
  const invalid = nicknameError(nameDraft.value)
  if (invalid) {
    nameMessage.value = invalid
    return
  }
  nameBusy.value = true
  nameMessage.value = ''
  try {
    await patchSettings({ nickname: nameDraft.value.trim() })
    void session.refreshMe()
    editingName.value = false
    toast.show(ME_COPY.nameSaved, { tone: 'ok' })
  } catch (e) {
    nameMessage.value = errorMessage(e)
  } finally {
    nameBusy.value = false
  }
}

async function logout(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await session.logout()
  } catch {
    /* 接口失败也清掉本地登录态（session.logout 的 finally），回登录页 */
  } finally {
    resetSettingsSync()
    resetProgress()
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
        <view class="pg-me__who">
          <PgMascot expr="happy" :motion="['breathe', 'blink']" :size="72" />
          <view class="pg-me__whotext">
            <view class="pg-me__namerow" role="button" tabindex="0" :aria-label="ME_COPY.editName" data-testid="me-edit-name" @tap="editingName = true" @keydown.enter.prevent="editingName = true">
              <text class="pg-me__name" data-testid="me-name">{{ name }}</text>
              <view class="pg-me__namepen"><PgIcon name="pen" :size="16" /></view>
            </view>
            <view v-if="classNames.length" class="pg-me__classes">
              <text v-for="className in classNames" :key="className" class="pg-me__class" data-testid="me-class">{{ className }}</text>
            </view>
          </view>
        </view>
        <view v-if="progress" class="pg-me__stats" data-testid="me-stats">
          <view class="pg-me__stat"><text class="pg-me__statnum" data-testid="me-stat-days">{{ progress.daysLearned }}</text><text class="pg-me__statlabel">{{ ME_COPY.daysLearned }}</text></view>
          <view class="pg-me__stat"><text class="pg-me__statnum" data-testid="me-stat-xp">{{ progress.xpTotal }}</text><text class="pg-me__statlabel">{{ ME_COPY.xp }}</text></view>
          <view class="pg-me__stat"><text class="pg-me__statnum" data-testid="me-stat-badges">{{ earned.length }}</text><text class="pg-me__statlabel">{{ ME_COPY.badges }}</text></view>
        </view>
        <PgSkeleton v-else-if="progressLoading" :count="1" />
        <text v-else-if="progressFailed" class="pg-me__statsfail" data-testid="me-stats-error">{{ PROGRESS_COPY.loadFailed }}</text>
      </PgCard>

      <PgCard v-if="badges.length" class="pg-me__shelf" lip role="button" tabindex="0" data-testid="me-badges" @tap="goPage('/pages/me/badges')" @keydown.enter.prevent="goPage('/pages/me/badges')">
        <view class="pg-me__shelfhead">
          <text class="pg-me__shelftitle">{{ ME_COPY.badgeRow }}</text>
          <text class="pg-me__shelfsub">{{ ME_COPY.badgeSub(earned.length, badges.length) }}</text>
          <PgIcon name="chevron" :size="18" class="pg-me__shelfchev" />
        </view>
        <view class="pg-me__medals" :aria-label="BADGE_COPY.summary(earned.length, badges.length)">
          <view v-for="badge in shelf" :key="badge.id" class="pg-me__medal" :class="{ 'pg-me__medal--on': badge.earnedAt }"><PgIcon :name="badgeIcon(badge.id)" :size="20" /></view>
        </view>
      </PgCard>

      <text class="pg-me__section">{{ ME_COPY.sectionLearn }}</text>
      <PgCard class="pg-me__group">
        <view class="pg-me__choice">
          <text class="pg-me__choicetitle">{{ ME_COPY.goalRow }}</text>
          <text class="pg-me__choicesub">{{ ME_COPY.goalSub }}</text>
          <PgSegmented :model-value="String(goal)" :options="goalOptions" :label="ME_COPY.goalRow" data-testid="me-goal" @update:model-value="pickGoal" />
        </view>
        <view class="pg-me__choice">
          <text class="pg-me__choicetitle">{{ ME_COPY.inputRow }}</text>
          <text class="pg-me__choicesub">{{ ME_COPY.inputSub }}</text>
          <PgSegmented :model-value="defaultInput" :options="INPUT_OPTIONS" :label="ME_COPY.inputRow" data-testid="me-input" @update:model-value="pickInput" />
        </view>
      </PgCard>

      <text class="pg-me__section">{{ ME_COPY.sectionLook }}</text>
      <PgSegmented class="pg-me__theme" :model-value="theme" :options="THEME_OPTIONS" label="外观" @update:model-value="saveTheme" />

      <text class="pg-me__section">{{ ME_COPY.sectionFeel }}</text>
      <PgCard flush>
        <PgListRow title="音效" sub="答对、提示和庆祝时的短音" icon="sound">
          <template #right><PgSwitch :model-value="sound" label="音效" data-testid="me-pref-sound" @update:model-value="togglePref('sound', $event)" /></template>
        </PgListRow>
        <PgListRow title="动效" sub="按钮回弹、页面过渡和撒花" icon="motion">
          <template #right><PgSwitch :model-value="motion" label="动效" data-testid="me-pref-motion" @update:model-value="togglePref('motion', $event)" /></template>
        </PgListRow>
        <PgListRow title="震动" sub="支持的手机上轻轻震一下" icon="vibrate">
          <template #right><PgSwitch :model-value="haptics" label="震动" data-testid="me-pref-haptics" @update:model-value="togglePref('haptics', $event)" /></template>
        </PgListRow>
      </PgCard>

      <text class="pg-me__section">{{ ME_COPY.sectionMore }}</text>
      <PgCard flush>
        <PgListRow :title="ME_COPY.accountRow" :sub="ME_COPY.accountSub" icon="keys" clickable data-testid="me-row-account" @tap="goPage('/pages/me/account')" />
        <PgListRow :title="ME_COPY.privacyRow" :sub="ME_COPY.privacySub" icon="lock" clickable data-testid="me-row-privacy" @tap="goPage('/pages/me/privacy')" />
        <ReplayOnboarding />
        <PgListRow :title="ME_COPY.feedbackRow" :sub="ME_COPY.feedbackSub" icon="flag" clickable data-testid="me-row-feedback" @tap="goPage('/pages/me/about?feedback=1')" />
        <PgListRow :title="ME_COPY.aboutRow" :sub="ME_COPY.aboutSub" icon="book" clickable data-testid="me-row-about" @tap="goPage('/pages/me/about')" />
      </PgCard>

      <PgButton class="pg-me__logout" variant="secondary" block data-testid="me-logout" @tap="confirmingLogout = true">{{ ME_COPY.logout }}</PgButton>
    </view>

    <PgSheet v-model:open="editingName" data-testid="me-name-sheet" :persistent="nameBusy">
      <view class="pg-me__sheet">
        <text class="pg-me__sheettitle">{{ ME_COPY.nameSheet }}</text>
        <PgField :hint="ME_COPY.nameHint" :error="nameMessage">
          <input v-model="nameDraft" class="pg-me__input" data-testid="me-name-input" :maxlength="NICKNAME_MAX" :placeholder="ME_COPY.namePlaceholder" @confirm="saveName" />
        </PgField>
        <PgButton block sound="tap" data-testid="me-name-save" :loading="nameBusy" @tap="saveName">{{ ME_COPY.nameSave }}</PgButton>
      </view>
    </PgSheet>

    <PgDialog
      v-model:open="confirmingLogout"
      :title="ME_COPY.logoutTitle"
      :body="ME_COPY.logoutBody"
      :confirm-text="ME_COPY.logoutConfirm"
      danger
      :busy="loggingOut"
      confirm-testid="me-logout-confirm"
      cancel-testid="me-logout-cancel"
      @confirm="logout"
    />
  </AppShell>
</template>

<style scoped>
.pg-me { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-me__profile { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-me__who { display: flex; align-items: center; gap: var(--sp-3); }
.pg-me__whotext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-me__namerow { display: flex; align-items: center; gap: var(--sp-1); min-height: var(--touch); cursor: pointer; }
.pg-me__name { min-width: 0; color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); overflow-wrap: anywhere; }
.pg-me__namepen { flex: none; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--paper-2); color: var(--ink-2); }
.pg-me__classes { display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.pg-me__class { padding: 2px var(--sp-2); border-radius: var(--radius-pill); background: var(--sea-soft); color: var(--sea-text); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pg-me__stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2); }
.pg-me__stat { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--sp-2) var(--sp-1); border-radius: var(--radius-12); background: var(--paper-2); }
.pg-me__statnum { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: 1.1; font-variant-numeric: tabular-nums; }
.pg-me__statlabel { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
.pg-me__statsfail { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-me__shelf { display: flex; flex-direction: column; gap: var(--sp-2); cursor: pointer; transition: transform var(--dur-base) var(--ease-spring); }
.pg-me__shelf:active { transform: translateY(2px); transition-duration: var(--dur-fast); }
.pg-me__shelfhead { display: flex; align-items: center; gap: var(--sp-2); }
.pg-me__shelftitle { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); }
.pg-me__shelfsub { flex: none; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-me__shelfchev { flex: none; color: var(--ink-2); }
.pg-me__medals { display: flex; gap: var(--sp-2); }
.pg-me__medal { flex: none; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--paper-2); color: var(--ink-3); }
.pg-me__medal--on { background: var(--bee); color: var(--on-bee); box-shadow: 0 var(--lip) 0 var(--bee-lip); }
.pg-me__section { margin-top: var(--sp-3); color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-me__group { display: flex; flex-direction: column; gap: var(--sp-4); }
.pg-me__choice { display: flex; flex-direction: column; gap: 2px; }
.pg-me__choice :deep(.pg-segmented) { margin-top: var(--sp-2); }
.pg-me__choicetitle { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); line-height: 1.35; }
.pg-me__choicesub { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.4; }
.pg-me__logout { margin-top: var(--sp-4); }
.pg-me__sheet { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-me__sheettitle { color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-me__input { width: 100%; min-height: var(--touch); box-sizing: border-box; padding: 0 var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-12); background: var(--paper); color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-bold); }
.pg-me__input:focus-within { border-color: var(--accent); }
</style>
