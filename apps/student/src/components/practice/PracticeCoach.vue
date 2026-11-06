<script setup lang="ts">
/**
 * 做题页的就地提示（只出现一次，存在 settings.onboarding.seen.*）。选哪一条在 onboarding/coach.ts；
 * 第一次手写时多放一小段笔画动画。测验模式 canShow 恒为假，所以测验里什么都不出。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PgCoachmark from '@/components/ui/PgCoachmark.vue'
import { useOnboarding } from '@/composables/useOnboarding'
import { COACH_COPY, TOUR_UI } from '@/copy/onboarding'
import { pickCoachKey, type CoachContext } from '@/onboarding/coach'
import type { OnboardingKey } from '@/onboarding/logic'

const props = defineProps<CoachContext>()

const onboarding = useOnboarding()
const shownKey = ref<OnboardingKey | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

const wanted = computed(() => (onboarding.ready.value ? pickCoachKey(props, (key) => onboarding.canShow(key)) : null))
const steps = computed(() => {
  const copy = shownKey.value ? COACH_COPY[shownKey.value] : undefined
  return copy ? [copy] : []
})

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

watch(
  wanted,
  (key) => {
    clearTimer()
    // 正在显示的那条留到学生点掉；要讲的东西变了就换。
    if (key === shownKey.value) return
    shownKey.value = null
    if (!key) return
    // 等抽屉和页面动画停稳再量位置。
    timer = setTimeout(() => {
      if (wanted.value === key) shownKey.value = key
    }, 450)
  },
  { immediate: true },
)

function close(): void {
  const key = shownKey.value
  shownKey.value = null
  if (key) void onboarding.markSeen(key)
}

onMounted(() => void onboarding.load())
onBeforeUnmount(clearTimer)
</script>

<template>
  <PgCoachmark :open="shownKey !== null" :steps="steps" :done-text="TOUR_UI.done" @done="close" @skip="close">
    <template #media>
      <svg v-if="shownKey === 'input.hand'" class="pg-coach-ink" viewBox="0 0 240 64" role="img" aria-label="笔画演示" data-testid="coach-ink-demo">
        <path class="pg-coach-ink__path" pathLength="1" d="M12 44c10-22 20-28 28-20s-2 26-10 22 8-24 26-20m14 18c8-12 16-18 22-12s-6 18 2 16 14-14 22-14m12 16c10-20 18-30 26-26s-4 28 4 26 14-16 26-18" />
      </svg>
    </template>
  </PgCoachmark>
</template>

<style scoped>
.pg-coach-ink { display: block; width: 100%; height: 56px; margin-top: var(--sp-2); }
.pg-coach-ink__path {
  fill: none;
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: pg-coach-ink 2.4s ease-in-out infinite;
}
@keyframes pg-coach-ink {
  0% { stroke-dashoffset: 1; }
  70%, 100% { stroke-dashoffset: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .pg-coach-ink__path { animation: none; stroke-dashoffset: 0; }
}
:global(html[data-motion='off']) .pg-coach-ink__path { animation: none; stroke-dashoffset: 0; }
</style>
