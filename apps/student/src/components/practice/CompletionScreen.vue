<script setup lang="ts">
/**
 * 完成页：全屏庆祝（撒花、音效、经验累加、连胜、关键步骤一排、新徽章）。主作答和换题的子作答共用。
 * 测验模式安静：没有撒花、音效和奖励数字，只说写完了。诚实说明一直在：系统没有校验逻辑顺序。
 */
import { computed, ref } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCelebration from '@/components/ui/PgCelebration.vue'
import PgFold from '@/components/ui/PgFold.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgStatChip from '@/components/ui/PgStatChip.vue'
import ReviewSheet from './ReviewSheet.vue'
import { COPY, independenceCopy } from '@/copy'
import { useCountUp } from '@/motion/useCountUp'
import type { AttemptState, RewardsView } from '@/types/attempt'

const props = withDefaults(
  defineProps<{
    state: AttemptState
    child?: boolean
    rewards?: RewardsView | null
    /** 从哪儿进来的：错题本、证明本重做时，主按钮回到那里。 */
    origin?: 'mistakes' | 'redo' | null
    busy?: boolean
  }>(),
  { child: false, rewards: null, origin: null, busy: false },
)
defineEmits<{
  (e: 'back-to-parent'): void
  (e: 'proofbook'): void
  (e: 'make-transfer'): void
  (e: 'next'): void
  (e: 'home'): void
}>()

const testMode = computed(() => props.state.mode === 'test')
const xp = computed(() => (testMode.value ? 0 : (props.rewards?.xp ?? 0)))
const displayXp = useCountUp(() => xp.value)
const streak = computed(() => (testMode.value ? null : (props.rewards?.streak ?? null)))
const badges = computed(() => (testMode.value ? [] : (props.rewards?.badges ?? [])))
const independence = computed(() => independenceCopy(props.state.budget.keysOwn, props.state.budget.keysTotal))
/** 一排步骤：前面的靠自己，后面的看过提示。 */
const stepChips = computed(() => {
  const { keysOwn, keysTotal } = props.state.budget
  return Array.from({ length: Math.max(0, keysTotal) }, (_, i) => ({ n: i + 1, own: i < keysOwn }))
})
const theorems = computed(() => props.state.completion?.leanCard?.theorems ?? [])
const nextLabel = computed(() => (props.origin === 'mistakes' ? '回错题本' : props.origin === 'redo' ? '回证明本' : '下一题'))
/** 换题只有带迁移题的主作答才有；重做和测验没有。 */
const canTransfer = computed(() => props.state.kind === 'main' && !testMode.value && !props.origin)
const reviewAvailable = computed(() => props.state.completion?.reviewAvailable === true)
const reviewOpen = ref(false)
</script>

<template>
  <PgCelebration v-if="child" open :quiet="testMode" title="这道题也完成了" expr="happy" :size="112">
    <view class="pg-done" data-testid="transfer-complete-card">
      <text class="pg-done__big" data-testid="transfer-complete-title">{{ independence }}</text>
      <view class="pg-done__note"><MathText :text="state.problem.title" /></view>
      <text class="pg-done__note">{{ COPY.honestNote }}</text>
    </view>
    <template #actions>
      <PgButton block size="lg" data-testid="back-to-parent" @tap="$emit('back-to-parent')">回到本题</PgButton>
      <PgButton block variant="secondary" data-testid="transfer-add-to-notebook" @tap="$emit('proofbook')">看我的证明</PgButton>
    </template>
  </PgCelebration>

  <PgCelebration v-else open :quiet="testMode" :title="testMode ? '写完了' : ''" :expr="testMode ? 'idle' : 'cheer'" :size="testMode ? 96 : 128">
    <view class="pg-done" data-testid="completion-card">
      <text class="pg-done__title pg-practice__donetitle" data-testid="completion-title">本题完成</text>

      <view v-if="xp > 0 || streak" class="pg-done__stats">
        <PgStatChip v-if="xp > 0" tone="bee" icon="star" :value="'+' + displayXp" label="经验" data-testid="completion-xp" />
        <PgStatChip v-if="streak" tone="fox" icon="flame" :value="streak.current" label="天连胜" data-testid="completion-streak" />
      </view>

      <template v-if="!testMode">
        <text class="pg-done__big" data-testid="completion-independence">{{ independence }}</text>
        <view class="pg-done__steps" data-testid="completion-steps" role="list" :aria-label="independence">
          <view
            v-for="step in stepChips"
            :key="step.n"
            class="pg-done__step"
            :class="{ 'pg-done__step--hint': !step.own }"
            :style="{ animationDelay: step.n * 80 + 'ms' }"
            role="listitem"
            :aria-label="'第 ' + step.n + ' 步' + (step.own ? '靠自己' : '看过提示')"
          >
            <PgIcon :name="step.own ? 'check' : 'bulb'" :size="24" color="currentColor" />
          </view>
        </view>
      </template>

      <view v-if="badges.length" class="pg-done__badges" data-testid="completion-badges">
        <view v-for="badge in badges" :key="badge.id" class="pg-done__badge">
          <PgIcon name="star" :size="24" color="currentColor" />
          <view class="pg-done__badgetext">
            <text class="pg-done__badgetitle">{{ badge.title }}</text>
            <text class="pg-done__badgedesc">{{ badge.desc }}</text>
          </view>
        </view>
      </view>

      <text class="pg-done__note" data-testid="completion-honest">{{ COPY.honestNote }}</text>

      <PgFold v-if="theorems.length" :title="COPY.extensionFold" class="pg-done__fold">
        <text>mathlib4 对照（只列定理名）：{{ theorems.join('、') }}</text>
      </PgFold>
    </view>

    <template #actions>
      <PgButton v-if="!testMode" block size="lg" data-testid="completion-next" :loading="busy" @tap="$emit('next')">{{ nextLabel }}</PgButton>
      <PgButton v-if="canTransfer" block variant="secondary" data-testid="make-transfer" :disabled="busy" @tap="$emit('make-transfer')">换题试试</PgButton>
      <PgButton v-if="reviewAvailable" block variant="secondary" data-testid="completion-review" :disabled="busy" @tap="reviewOpen = true">看讲评</PgButton>
      <PgButton block variant="ghost" data-testid="add-to-notebook" :disabled="busy" @tap="$emit('proofbook')">看我的证明</PgButton>
      <PgButton block variant="ghost" data-testid="back-home" :disabled="busy" @tap="$emit('home')">回首页</PgButton>
      <ReviewSheet v-model:open="reviewOpen" :attempt-id="state.attemptId" />
    </template>
  </PgCelebration>
</template>

<style scoped>
.pg-done { display: flex; flex-direction: column; align-items: center; gap: var(--sp-3); width: 100%; }
.pg-done__title { color: var(--ink); font-size: var(--fs-28); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-done__big { color: var(--accent-text); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-done__stats { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); }
.pg-done__steps { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-2); }
.pg-done__step {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--ok-soft);
  color: var(--ok-text);
  box-shadow: 0 var(--lip) 0 var(--ok);
  animation: pg-pop 380ms var(--ease-spring) both;
}
.pg-done__step--hint { background: var(--bee-soft); color: var(--bee-text); box-shadow: 0 var(--lip) 0 var(--bee); }
.pg-done__badges { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; }
.pg-done__badge { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: var(--bw) solid var(--bee); border-radius: var(--radius-16); background: var(--bee-soft); color: var(--bee-text); text-align: left; animation: pg-item-in var(--dur-slow) var(--ease-out) both; }
.pg-done__badgetext { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pg-done__badgetitle { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); }
.pg-done__badgedesc { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-done__note { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-bold); line-height: 1.5; }
.pg-done__fold { align-self: stretch; text-align: left; }
</style>
