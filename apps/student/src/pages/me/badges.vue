<script setup lang="ts">
/**
 * 我的徽章：拿到的金色 + 日期，没拿到的灰色 + 条件和进度。目录和进度都来自 GET /student/progress。
 */
import { computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import MeSubHeader from '@/components/me/MeSubHeader.vue'
import { applyApiOverride } from '@/components/path/openPractice'
import { badgeFraction, badgeIcon, earnedBadges } from '@/components/progressLogic'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import { useProgress } from '@/composables/useProgress'
import { BADGE_COPY } from '@/copy'
import { formatDate } from '@/utils/date'

const { progress, loading, failed, load } = useProgress()

onLoad((q) => {
  applyApiOverride(q)
})

onShow(() => {
  void load(true)
})

const badges = computed(() => {
  const all = progress.value?.badges ?? []
  // 拿到的排前面，其余保持目录顺序。
  return [...all.filter((badge) => badge.earnedAt), ...all.filter((badge) => !badge.earnedAt)]
})
const earnedCount = computed(() => earnedBadges(badges.value).length)
const allDone = computed(() => badges.value.length > 0 && earnedCount.value === badges.value.length)
</script>

<template>
  <AppShell active="me">
    <view class="pg-badges" data-testid="badges-page">
      <MeSubHeader :title="BADGE_COPY.title" />

      <view v-if="loading && !progress" class="pg-badges__loading" data-testid="badges-loading" aria-busy="true">
        <PgSkeleton variant="block" :count="4" />
      </view>

      <view v-else-if="failed && !progress" data-testid="badges-error" role="alert">
        <PgEmpty :title="BADGE_COPY.loadFailedTitle" expr="oops" :motion="null" :size="88" action="重试" action-testid="badges-retry" @action="load(true)" />
      </view>

      <template v-else-if="progress">
        <view class="pg-badges__summary">
          <text class="pg-badges__count" data-testid="badges-summary">{{ BADGE_COPY.summary(earnedCount, badges.length) }}</text>
          <text class="pg-badges__hint">{{ allDone ? BADGE_COPY.allDone : BADGE_COPY.nextHint }}</text>
        </view>

        <view class="pg-badges__grid pg-stagger">
          <view
            v-for="badge in badges"
            :key="badge.id"
            class="pg-badge"
            :class="{ 'pg-badge--on': badge.earnedAt }"
            data-testid="badge-card"
            :data-badge="badge.id"
            :data-earned="badge.earnedAt ? 'true' : 'false'"
          >
            <view class="pg-badge__medal"><PgIcon :name="badgeIcon(badge.id)" :size="30" /></view>
            <text class="pg-badge__title">{{ badge.title }}</text>
            <text class="pg-badge__desc">{{ badge.desc }}</text>
            <text v-if="badge.earnedAt" class="pg-badge__date">{{ BADGE_COPY.earned(formatDate(badge.earnedAt)) }}</text>
            <view v-else-if="badge.progress" class="pg-badge__progress">
              <PgProgress :value="badgeFraction(badge)" tone="bee" :label="badge.title" />
              <text class="pg-badge__numbers">{{ BADGE_COPY.progress(badge.progress.current, badge.progress.target) }}</text>
            </view>
          </view>
        </view>
      </template>
    </view>
  </AppShell>
</template>

<style scoped>
.pg-badges { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-badges__loading { display: flex; flex-direction: column; gap: var(--sp-3); }
.pg-badges__summary { display: flex; flex-direction: column; gap: 2px; }
.pg-badges__count { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-badges__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-badges__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-3); }
.pg-badge { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); min-width: 0; padding: var(--sp-4) var(--sp-3); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); background: var(--sheet); text-align: center; }
.pg-badge__medal { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; margin-bottom: var(--sp-1); border-radius: 50%; background: var(--paper-2); color: var(--ink-3); }
.pg-badge--on { border-color: var(--bee); }
.pg-badge--on .pg-badge__medal { background: var(--bee); color: var(--on-bee); box-shadow: 0 var(--lip) 0 var(--bee-lip); }
.pg-badge__title { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.3; }
.pg-badge__desc { color: var(--ink-2); font-size: var(--fs-12); line-height: 1.45; }
.pg-badge__date { margin-top: var(--sp-1); color: var(--bee-text); font-size: var(--fs-12); font-weight: var(--fw-black); }
.pg-badge__progress { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 2px; margin-top: var(--sp-1); }
.pg-badge__numbers { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); font-variant-numeric: tabular-nums; }
@media (min-width: 600px) {
  .pg-badges__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
