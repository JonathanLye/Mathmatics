<script setup lang="ts">
/**
 * 欢迎页（首次设置，同意书之后）：开场动画 → 昵称 → 每天几步 → 默认怎么写 → 庆祝，然后回首页开始导览。
 * - 一屏一个问题；昵称、每日目标、默认输入一次写完（PATCH /student/settings），失败留在原地重试；
 * - 已经走过（或老用户早有昵称）直接去首页；读不到设置也直接去首页，不拦学生；
 * - ?replay=1：从“我的 → 重看引导”进来，只放开场动画，放完回首页再走一遍导览。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { errorMessage } from '@/api/client'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import IntroStory from '@/components/onboarding/IntroStory.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCelebration from '@/components/ui/PgCelebration.vue'
import PgField from '@/components/ui/PgField.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { deviceIntroSeen, markDeviceIntroSeen, useOnboarding } from '@/composables/useOnboarding'
import { COPY } from '@/copy'
import { DAILY_GOALS, INPUT_CHOICES, WELCOME_COPY } from '@/copy/onboarding'
import { nextWelcomeStep, previousWelcomeStep, type WelcomeStep } from '@/onboarding/welcomeSteps'
import { useSession } from '@/stores/session'

const session = useSession()
const onboarding = useOnboarding()

const ready = ref(false)
const introOpen = ref(false)
const replay = ref(false)
const step = ref<WelcomeStep>('name')
const direction = ref<'fwd' | 'back'>('fwd')
const nickname = ref('')
const dailyGoal = ref(3)
const defaultInput = ref<'hand' | 'keyboard' | 'photo'>('hand')
const saving = ref(false)
const error = ref('')
const celebrate = ref(false)

const trimmed = computed(() => nickname.value.trim())
const displayName = computed(() => trimmed.value || COPY.studentFallbackName)
const stepIndex = computed(() => ['name', 'goal', 'input'].indexOf(step.value))
const mascotExpr = computed(() => (step.value === 'name' ? 'idle' : step.value === 'goal' ? 'happy' : 'think'))

function goHome(): void {
  uni.redirectTo({ url: '/pages/home/index' })
}

onLoad(async (query) => {
  if (!ageGatePassed(await enforceAgeGate())) return
  if (!session.consented.value) {
    uni.redirectTo({ url: '/pages/consent/index' })
    return
  }
  if (query?.replay === '1') {
    replay.value = true
    ready.value = true
    introOpen.value = true
    return
  }
  // 没读到设置或已经走过：直接首页。
  if (!(await onboarding.load()) || !onboarding.welcomeNeeded()) {
    goHome()
    return
  }
  ready.value = true
  if (onboarding.canShow('intro')) {
    if (deviceIntroSeen()) void onboarding.markSeen('intro')
    else introOpen.value = true
  }
})

function onIntroDone(): void {
  introOpen.value = false
  markDeviceIntroSeen()
  void onboarding.markSeen('intro')
  if (replay.value) goHome()
}

function go(to: WelcomeStep, dir: 'fwd' | 'back'): void {
  direction.value = dir
  step.value = to
  error.value = ''
}

function next(): void {
  if (step.value === 'name' && trimmed.value.length > 16) {
    error.value = WELCOME_COPY.nameTooLong
    return
  }
  const to = nextWelcomeStep(step.value)
  if (to) go(to, 'fwd')
  else void finish()
}

function back(): void {
  const to = previousWelcomeStep(step.value)
  if (to) go(to, 'back')
}

function skipName(): void {
  nickname.value = ''
  go('goal', 'fwd')
}

async function finish(): Promise<void> {
  if (saving.value) return
  saving.value = true
  error.value = ''
  try {
    await onboarding.saveWelcome({
      ...(trimmed.value ? { nickname: trimmed.value } : {}),
      dailyGoal: dailyGoal.value,
      defaultInput: defaultInput.value,
    })
    celebrate.value = true
  } catch (e) {
    const text = errorMessage(e)
    error.value = /[一-鿿]/.test(text) ? text : WELCOME_COPY.saveFailed
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="pg-page pg-form-page pg-welcome" data-testid="welcome-page">
    <view v-if="ready && !replay" class="pg-form-column pg-welcome__column">
      <view class="pg-welcome__dots" role="img" :aria-label="WELCOME_COPY.stepOf(stepIndex + 1, 3)">
        <view v-for="i in 3" :key="i" class="pg-welcome__dot" :class="{ 'pg-welcome__dot--on': i - 1 === stepIndex, 'pg-welcome__dot--past': i - 1 < stepIndex }" />
      </view>

      <view :key="step" class="pg-welcome__step" :class="'pg-welcome__step--' + direction" :data-step="step">
        <PgMascot :expr="mascotExpr" :motion="step === 'goal' ? ['hop', 'blink'] : step === 'input' ? ['think-tilt', 'blink'] : ['breathe', 'blink']" :size="96" />

        <!-- 1 昵称 -->
        <template v-if="step === 'name'">
          <text class="pg-welcome__title" data-testid="welcome-title">{{ WELCOME_COPY.nameTitle }}</text>
          <text class="pg-welcome__sub">{{ WELCOME_COPY.nameSub }}</text>
          <PgField class="pg-welcome__field" :label="WELCOME_COPY.nameLabel" :hint="WELCOME_COPY.nameHint" :error="error">
            <input v-model="nickname" class="pg-welcome__input" data-testid="welcome-nickname" maxlength="16" :placeholder="WELCOME_COPY.namePlaceholder" @confirm="trimmed && next()" />
          </PgField>
        </template>

        <!-- 2 每日目标 -->
        <template v-else-if="step === 'goal'">
          <text class="pg-welcome__title" data-testid="welcome-title">{{ WELCOME_COPY.goalTitle }}</text>
          <text class="pg-welcome__sub">{{ WELCOME_COPY.goalSub }}</text>
          <view class="pg-welcome__cards pg-stagger" role="radiogroup" :aria-label="WELCOME_COPY.goalTitle">
            <view
              v-for="goal in DAILY_GOALS"
              :key="goal.value"
              class="pg-welcome__card pg-press"
              :class="['pg-welcome__card--' + goal.tone, { 'pg-welcome__card--on': dailyGoal === goal.value }]"
              role="radio"
              tabindex="0"
              :aria-checked="dailyGoal === goal.value ? 'true' : 'false'"
              :data-testid="'welcome-goal-' + goal.value"
              @tap="dailyGoal = goal.value"
              @keydown.enter.prevent="dailyGoal = goal.value"
              @keydown.space.prevent="dailyGoal = goal.value"
            >
              <view class="pg-welcome__badge"><PgIcon :name="goal.icon" :size="26" /></view>
              <view class="pg-welcome__cardtext">
                <text class="pg-welcome__cardname">{{ goal.name }}</text>
                <text class="pg-welcome__carddesc">{{ goal.desc }}</text>
              </view>
              <view class="pg-welcome__tick"><PgIcon name="check" :size="16" /></view>
            </view>
          </view>
        </template>

        <!-- 3 默认输入 -->
        <template v-else>
          <text class="pg-welcome__title" data-testid="welcome-title">{{ WELCOME_COPY.inputTitle }}</text>
          <text class="pg-welcome__sub">{{ WELCOME_COPY.inputSub }}</text>
          <view class="pg-welcome__cards pg-stagger" role="radiogroup" :aria-label="WELCOME_COPY.inputTitle">
            <view
              v-for="choice in INPUT_CHOICES"
              :key="choice.value"
              class="pg-welcome__card pg-welcome__card--sea pg-press"
              :class="{ 'pg-welcome__card--on': defaultInput === choice.value }"
              role="radio"
              tabindex="0"
              :aria-checked="defaultInput === choice.value ? 'true' : 'false'"
              :data-testid="'welcome-input-' + choice.value"
              @tap="defaultInput = choice.value"
              @keydown.enter.prevent="defaultInput = choice.value"
              @keydown.space.prevent="defaultInput = choice.value"
            >
              <view class="pg-welcome__demo" aria-hidden="true">
                <svg v-if="choice.value === 'hand'" class="pgw-hand" viewBox="0 0 64 44" focusable="false">
                  <path class="pgw-hand__ink" d="M8 30 C 14 8, 22 8, 24 24 S 30 36, 38 14 M34 34 C 40 30, 46 26, 56 12" />
                  <circle class="pgw-hand__tip" cx="56" cy="12" r="3" />
                </svg>
                <view v-else-if="choice.value === 'keyboard'" class="pgw-keys">
                  <view class="pgw-keys__key pgw-keys__key--1"><text>x</text></view>
                  <view class="pgw-keys__key pgw-keys__key--2"><text>²</text></view>
                  <view class="pgw-keys__key pgw-keys__key--3"><text>≤</text></view>
                </view>
                <view v-else class="pgw-photo">
                  <view class="pgw-photo__frame" />
                  <view class="pgw-photo__scan" />
                  <view class="pgw-photo__flash" />
                </view>
              </view>
              <view class="pg-welcome__cardtext">
                <text class="pg-welcome__cardname">{{ choice.name }}</text>
                <text class="pg-welcome__carddesc">{{ choice.desc }}</text>
              </view>
              <view class="pg-welcome__tick"><PgIcon name="check" :size="16" /></view>
            </view>
          </view>
          <text v-if="error" class="pg-welcome__error" data-testid="welcome-error" role="alert">{{ error }}</text>
        </template>
      </view>

      <view class="pg-welcome__actions">
        <PgButton block size="lg" data-testid="welcome-next" :loading="saving" :disabled="step === 'name' && !trimmed" @tap="next">
          {{ saving ? WELCOME_COPY.saving : step === 'input' ? WELCOME_COPY.finish : WELCOME_COPY.next }}
        </PgButton>
        <PgButton v-if="step === 'name'" variant="ghost" block data-testid="welcome-skip-name" @tap="skipName">{{ WELCOME_COPY.skipName }}</PgButton>
        <PgButton v-else variant="ghost" block data-testid="welcome-back" @tap="back">{{ WELCOME_COPY.back }}</PgButton>
      </view>
    </view>

    <PgCelebration :open="celebrate" :title="WELCOME_COPY.readyTitle(displayName)">
      <text class="pg-welcome__ready">{{ WELCOME_COPY.readySub }}</text>
      <PgButton size="lg" data-testid="welcome-go" @tap="goHome">{{ WELCOME_COPY.readyGo }}</PgButton>
    </PgCelebration>

    <IntroStory v-if="introOpen" @done="onIntroDone" />
  </view>
</template>

<style scoped>
.pg-welcome__column { display: flex; flex-direction: column; gap: var(--sp-5); min-height: calc(100dvh - var(--sp-10)); }
.pg-welcome__dots { display: flex; justify-content: center; gap: var(--sp-2); }
.pg-welcome__dot { width: 10px; height: 10px; border-radius: var(--radius-pill); background: var(--rule-2); transition: width var(--dur-base) var(--ease-spring), background var(--dur-base) ease-out; }
.pg-welcome__dot--past { background: var(--accent); }
.pg-welcome__dot--on { width: 28px; background: var(--accent); }

.pg-welcome__step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); animation: pgw-in-fwd var(--dur-slow) var(--ease-out) both; }
.pg-welcome__step--back { animation-name: pgw-in-back; }
@keyframes pgw-in-fwd { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes pgw-in-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
.pg-welcome__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); text-align: center; }
.pg-welcome__sub { color: var(--ink-2); font-size: var(--fs-15); line-height: var(--lh-body); text-align: center; }
.pg-welcome__field { width: 100%; margin-top: var(--sp-2); }
.pg-welcome__input {
  min-height: 52px; padding: 0 var(--sp-4);
  border: var(--bw) solid var(--rule); border-bottom-width: calc(var(--bw) + var(--lip) - 2px); border-radius: var(--radius-16);
  background: var(--sheet); color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black);
  transition: border-color var(--dur-fast) ease-out;
}
.pg-welcome__input:focus-within { border-color: var(--accent); }
.pg-welcome__error { width: 100%; padding: var(--sp-3); border-radius: var(--radius-12); background: var(--fox-soft); color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-black); animation: pg-shake 320ms ease-in-out both; }
.pg-welcome__actions { display: flex; flex-direction: column; gap: var(--sp-2); padding-top: var(--sp-2); }
.pg-welcome__ready { color: var(--ink-2); font-size: var(--fs-15); text-align: center; }

/* 选择卡 */
.pg-welcome__cards { display: flex; flex-direction: column; gap: var(--sp-3); width: 100%; margin-top: var(--sp-2); }
.pg-welcome__card {
  --_c: var(--accent); --_soft: var(--accent-soft); --_lip: var(--accent-lip);
  display: flex; align-items: center; gap: var(--sp-3); min-height: 76px; padding: var(--sp-3) var(--sp-4);
  border: var(--bw) solid var(--rule); border-bottom-width: calc(var(--bw) + var(--lip) - 2px); border-radius: var(--radius-16);
  background: var(--sheet); cursor: pointer; user-select: none; -webkit-user-select: none;
  transition: border-color var(--dur-base) ease-out, background var(--dur-base) ease-out, transform var(--dur-base) var(--ease-spring);
}
.pg-welcome__card--ok { --_c: var(--ok); --_soft: var(--ok-soft); --_lip: var(--ok-lip); }
.pg-welcome__card--bee { --_c: var(--bee); --_soft: var(--bee-soft); --_lip: var(--bee-lip); }
.pg-welcome__card--fox { --_c: var(--fox); --_soft: var(--fox-soft); --_lip: var(--fox-lip); }
.pg-welcome__card--sea { --_c: var(--sea); --_soft: var(--sea-soft); --_lip: var(--sea-lip); }
.pg-welcome__card--on { border-color: var(--_c); background: var(--_soft); transform: translateY(-2px); }
.pg-welcome__badge { display: flex; align-items: center; justify-content: center; flex: none; width: 48px; height: 48px; border-radius: 50%; background: var(--_c); color: var(--on-accent); box-shadow: 0 3px 0 var(--_lip); }
.pg-welcome__card--ok .pg-welcome__badge { color: var(--on-ok); }
.pg-welcome__card--bee .pg-welcome__badge { color: var(--on-bee); }
.pg-welcome__card--fox .pg-welcome__badge { color: var(--on-fox); }
.pg-welcome__card--on .pg-welcome__badge { animation: pg-pop 380ms var(--ease-spring) both; }
.pg-welcome__cardtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-welcome__cardname { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-welcome__carddesc { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.45; }
.pg-welcome__tick { display: flex; align-items: center; justify-content: center; flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--rule); color: transparent; transition: background var(--dur-base) ease-out, color var(--dur-base) ease-out, transform var(--dur-base) var(--ease-spring); }
.pg-welcome__card--on .pg-welcome__tick { background: var(--_c); color: var(--on-accent); transform: scale(1.1); }
.pg-welcome__card--ok.pg-welcome__card--on .pg-welcome__tick { color: var(--on-ok); }
.pg-welcome__card--bee.pg-welcome__card--on .pg-welcome__tick { color: var(--on-bee); }
.pg-welcome__card--fox.pg-welcome__card--on .pg-welcome__tick { color: var(--on-fox); }

/* 输入方式的小演示 */
.pg-welcome__demo { display: flex; align-items: center; justify-content: center; flex: none; width: 72px; height: 52px; border-radius: var(--radius-12); background: var(--paper-2); overflow: hidden; }
.pgw-hand { width: 60px; height: 42px; overflow: visible; }
.pgw-hand__ink { fill: none; stroke: var(--sea-text); stroke-width: 3.2; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 160; stroke-dashoffset: 160; animation: pgw-draw 2800ms ease-in-out infinite both; }
.pgw-hand__tip { fill: var(--sea); opacity: 0; animation: pgw-tip 2800ms ease-in-out infinite both; }
@keyframes pgw-draw { 0% { stroke-dashoffset: 160; } 55%, 100% { stroke-dashoffset: 0; } }
@keyframes pgw-tip { 0%, 52% { opacity: 0; } 58%, 84% { opacity: 1; } 100% { opacity: 0; } }
.pgw-keys { display: flex; gap: 4px; }
.pgw-keys__key { display: flex; align-items: center; justify-content: center; width: 18px; height: 22px; border: 2px solid var(--rule-2); border-bottom-width: 4px; border-radius: 6px; background: var(--sheet); color: var(--ink); font-size: 12px; font-weight: 900; animation: pgw-key 2400ms ease-in-out infinite both; }
.pgw-keys__key--2 { animation-delay: 300ms; }
.pgw-keys__key--3 { animation-delay: 600ms; }
@keyframes pgw-key { 0%, 30%, 100% { transform: none; border-bottom-width: 4px; background: var(--sheet); } 12% { transform: translateY(2px); border-bottom-width: 2px; background: var(--sea-soft); } }
.pgw-photo { position: relative; width: 44px; height: 34px; }
.pgw-photo__frame { position: absolute; inset: 0; border: 3px solid var(--sea); border-radius: 8px; }
.pgw-photo__scan { position: absolute; left: 4px; right: 4px; top: 6px; height: 3px; border-radius: 2px; background: var(--sea); animation: pgw-scan 2200ms ease-in-out infinite both; }
.pgw-photo__flash { position: absolute; inset: -4px; border-radius: 10px; background: var(--shine); opacity: 0; animation: pgw-flash 2200ms ease-in-out infinite both; }
@keyframes pgw-scan { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(18px); } }
@keyframes pgw-flash { 0%, 70%, 100% { opacity: 0; } 76% { opacity: 0.9; } }
</style>
