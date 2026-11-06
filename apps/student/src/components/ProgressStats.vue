<script setup lang="ts">
/**
 * 三个数字：连胜 / 经验 / 今日目标。手机在首页顶部，桌面在右栏（右栏的今日目标是大圆环，这里可以隐藏）。
 * 没拿到数据时显示占位，不编数字；数字变化时滚动。
 */
import { computed } from 'vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import ProgressRing from '@/components/ProgressRing.vue'
import { goalFraction, goalReached } from '@/components/progressLogic'
import { useCountUp } from '@/motion/useCountUp'
import type { ProgressView } from '@/types/attempt'

const props = withDefaults(defineProps<{ progress: Readonly<ProgressView> | null; hideGoal?: boolean }>(), { hideGoal: false })

const streak = useCountUp(computed(() => props.progress?.streak.current ?? 0))
const xp = useCountUp(computed(() => props.progress?.xpTotal ?? 0))
const keys = useCountUp(computed(() => props.progress?.keysToday ?? 0))
const ready = computed(() => props.progress !== null)
const reached = computed(() => goalReached(props.progress))
const fraction = computed(() => goalFraction(props.progress))
const lit = computed(() => (props.progress?.streak.current ?? 0) > 0)
</script>

<template>
  <view class="pg-stats" :class="{ 'pg-stats--pending': !ready }" data-testid="progress-stats">
    <view class="pg-stats__item" :class="{ 'pg-stats__item--fox': lit }" data-testid="home-streak" :aria-label="ready ? '连胜 ' + progress?.streak.current + ' 天' : '连胜'">
      <PgIcon name="flame" :size="26" class="pg-stats__icon" />
      <view class="pg-stats__text">
        <text class="pg-stats__value">{{ ready ? streak : '—' }}</text>
        <text class="pg-stats__label">连胜</text>
      </view>
    </view>
    <view class="pg-stats__item pg-stats__item--bee" data-testid="home-xp" :aria-label="ready ? '经验 ' + progress?.xpTotal : '经验'">
      <PgIcon name="star" :size="26" class="pg-stats__icon" />
      <view class="pg-stats__text">
        <text class="pg-stats__value">{{ ready ? xp : '—' }}</text>
        <text class="pg-stats__label">经验</text>
      </view>
    </view>
    <view
      v-if="!hideGoal"
      class="pg-stats__item"
      :class="reached ? 'pg-stats__item--bee' : 'pg-stats__item--accent'"
      data-testid="home-daily-goal"
      :aria-label="ready ? '今日目标 ' + progress?.keysToday + ' / ' + progress?.dailyGoal + ' 个关键步骤' : '今日目标'"
    >
      <ProgressRing :value="fraction" :size="28" :stroke="5" :tone="reached ? 'bee' : 'accent'">
        <PgIcon v-if="reached" name="check" :size="14" class="pg-stats__icon" />
      </ProgressRing>
      <view class="pg-stats__text">
        <text class="pg-stats__value">{{ ready ? keys + '/' + progress?.dailyGoal : '—' }}</text>
        <text class="pg-stats__label">今日目标</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-stats { display: flex; gap: var(--sp-2); min-width: 0; }
.pg-stats__item {
  --_ink: var(--ink-2);
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 52px;
  padding: var(--sp-1) var(--sp-2);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-16);
  background: var(--sheet);
  color: var(--_ink);
}
.pg-stats__item--fox { --_ink: var(--fox-text); }
.pg-stats__item--bee { --_ink: var(--bee-text); }
.pg-stats__item--accent { --_ink: var(--accent-text); }
.pg-stats__icon { flex: none; color: var(--_ink); }
.pg-stats__item--fox .pg-stats__icon { color: var(--fox); }
.pg-stats__item--bee .pg-stats__icon { color: var(--bee-lip); }
.pg-stats__text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pg-stats__value { font-size: var(--fs-16); font-weight: var(--fw-black); line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-stats__label { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); line-height: 1.2; white-space: nowrap; }
.pg-stats--pending .pg-stats__item { --_ink: var(--ink-2); }
@media (max-width: 340px) {
  .pg-stats { gap: var(--sp-1); }
  .pg-stats__item { gap: 4px; padding: var(--sp-1) 6px; }
  .pg-stats__label { font-size: 11px; }
}
</style>
