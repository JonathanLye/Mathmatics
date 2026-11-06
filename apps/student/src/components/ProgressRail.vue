<script setup lang="ts">
/**
 * 桌面右栏：连胜和经验、今日目标圆环、这一周的七个点、下一枚徽章。外壳在 ≥1024 时挂它。
 * 数据拿不到时只留一句话，不编数字。
 */
import { computed, onMounted } from 'vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import ProgressRing from '@/components/ProgressRing.vue'
import ProgressStats from '@/components/ProgressStats.vue'
import { badgeFraction, badgeIcon, goalFraction, goalReached, nextBadge, weekDots } from '@/components/progressLogic'
import { useProgress } from '@/composables/useProgress'
import { PROGRESS_COPY } from '@/copy'

const { progress, failed, load } = useProgress()

onMounted(() => {
  void load()
})

const fraction = computed(() => goalFraction(progress.value))
const reached = computed(() => goalReached(progress.value))
const dots = computed(() => (progress.value ? weekDots(progress.value) : []))
const upcoming = computed(() => (progress.value ? nextBadge(progress.value.badges) : null))

function goBadges(): void {
  uni.navigateTo({ url: '/pages/me/badges' })
}
</script>

<template>
  <view class="pg-rail" data-testid="progress-rail">
    <ProgressStats :progress="progress" hide-goal />

    <template v-if="progress">
      <PgCard class="pg-rail__goal" :tone="reached ? 'bee' : 'plain'" data-testid="home-daily-goal">
        <ProgressRing :value="fraction" :size="72" :stroke="9" :tone="reached ? 'bee' : 'accent'">
          <PgIcon v-if="reached" name="check" :size="28" class="pg-rail__goalcheck" />
          <text v-else class="pg-rail__goalnum">{{ progress.keysToday }}/{{ progress.dailyGoal }}</text>
        </ProgressRing>
        <view class="pg-rail__goaltext">
          <text class="pg-rail__title">{{ PROGRESS_COPY.goalTitle }}</text>
          <text class="pg-rail__sub">{{ reached ? PROGRESS_COPY.goalReached : PROGRESS_COPY.goalLeft(progress.dailyGoal - progress.keysToday) }}</text>
        </view>
      </PgCard>

      <PgCard class="pg-rail__week" data-testid="rail-week">
        <view class="pg-rail__weekhead">
          <text class="pg-rail__title">{{ PROGRESS_COPY.streakDays(progress.streak.current) }}</text>
          <text v-if="progress.streak.freezeAvailable" class="pg-rail__freeze">{{ PROGRESS_COPY.freezeReady }}</text>
        </view>
        <view class="pg-rail__dots">
          <view v-for="dot in dots" :key="dot.day" class="pg-rail__day" :class="{ 'pg-rail__day--today': dot.isToday }">
            <view class="pg-rail__dot" :class="'pg-rail__dot--' + dot.state">
              <PgIcon v-if="dot.state === 'done'" name="flame" :size="16" />
            </view>
            <text class="pg-rail__daylabel">{{ dot.label }}</text>
          </view>
        </view>
      </PgCard>

      <PgCard v-if="upcoming" class="pg-rail__badge" lip role="button" tabindex="0" data-testid="rail-next-badge" @tap="goBadges" @keydown.enter.prevent="goBadges">
        <view class="pg-rail__medal"><PgIcon :name="badgeIcon(upcoming.id)" :size="24" /></view>
        <view class="pg-rail__badgetext">
          <text class="pg-rail__kicker">{{ PROGRESS_COPY.nextBadge }}</text>
          <text class="pg-rail__title">{{ upcoming.title }}</text>
          <text class="pg-rail__sub">{{ upcoming.desc }}</text>
          <PgProgress v-if="upcoming.progress" class="pg-rail__badgebar" :value="badgeFraction(upcoming)" tone="bee" :label="upcoming.title" />
        </view>
      </PgCard>
    </template>

    <PgCard v-else-if="failed" class="pg-rail__fail" data-testid="rail-error">
      <PgMascot expr="sleepy" :size="48" />
      <text class="pg-rail__sub">{{ PROGRESS_COPY.loadFailed }}</text>
    </PgCard>
    <PgCard v-else><PgSkeleton :count="3" /></PgCard>
  </view>
</template>

<style scoped>
.pg-rail { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-rail__title { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.3; }
.pg-rail__sub { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.45; }
.pg-rail__kicker { color: var(--bee-text); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pg-rail__goal { display: flex; align-items: center; gap: var(--sp-3); }
.pg-rail__goaltext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-rail__goalnum { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; }
.pg-rail__goalcheck { color: var(--bee-lip); }
.pg-rail__week { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-rail__weekhead { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.pg-rail__freeze { flex: none; color: var(--sea-text); font-size: var(--fs-12); font-weight: var(--fw-heavy); }
.pg-rail__dots { display: flex; justify-content: space-between; gap: 2px; }
.pg-rail__day { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); }
.pg-rail__dot {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--bw) solid var(--rule);
  border-radius: 50%;
  background: var(--paper-2);
  color: var(--on-fox);
}
.pg-rail__dot--done { border-color: var(--fox-lip); background: var(--fox); }
.pg-rail__dot--freeze { border-color: var(--sea); background: var(--sea-soft); }
.pg-rail__dot--today { border-color: var(--accent); background: var(--sheet); }
.pg-rail__dot--future { background: transparent; }
.pg-rail__daylabel { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); line-height: 1; }
.pg-rail__day--today .pg-rail__daylabel { color: var(--accent-text); font-weight: var(--fw-black); }
.pg-rail__badge { display: flex; gap: var(--sp-3); cursor: pointer; }
.pg-rail__badge:active { transform: translateY(2px); }
.pg-rail__medal {
  flex: none;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bee-soft);
  box-shadow: 0 3px 0 var(--bee);
  color: var(--bee-text);
}
.pg-rail__badgetext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-rail__badgebar { margin-top: var(--sp-2); }
.pg-rail__fail { display: flex; align-items: center; gap: var(--sp-3); }
</style>
