<script setup lang="ts">
/**
 * 新手引导的一步：聚光灯挖洞 + 小方气泡 + 下一步/跳过。
 * target 是 CSS 选择器；自动滚到视野内，窗口变化时重新定位。找不到目标时气泡仍居中显示，不会卡住。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PgButton from './PgButton.vue'
import PgMascot from './PgMascot.vue'
import { useFeedbackPrefs } from '@/motion/useFeedbackPrefs'
import { coachmarkBubble, coachmarkNext, spotlightRect, type Rect } from './uiLogic'

export interface CoachmarkStep {
  target: string
  title: string
  body?: string
}

const props = withDefaults(
  defineProps<{ open: boolean; steps: readonly CoachmarkStep[]; index?: number; nextText?: string; doneText?: string; skipText?: string }>(),
  { index: 0, nextText: '下一步', doneText: '知道了', skipText: '跳过' },
)
const emit = defineEmits<{
  (e: 'update:index', index: number): void
  (e: 'next', index: number): void
  (e: 'skip'): void
  (e: 'done'): void
}>()

const { motionEnabled } = useFeedbackPrefs()
const step = computed(() => props.steps[props.index] ?? null)
const isLast = computed(() => coachmarkNext(props.index, props.steps.length) === null)
const hole = ref<Rect | null>(null)
const viewport = ref({ width: 390, height: 844 })
const bubbleEl = ref<unknown>(null)
const bubbleHeight = ref(180)

const holeStyle = computed(() => {
  const r = hole.value
  if (!r) return { display: 'none' }
  return { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' }
})
const bubbleStyle = computed(() => {
  const r = hole.value ?? { top: viewport.value.height / 2 - 90, left: 0, width: viewport.value.width, height: 0 }
  const p = coachmarkBubble(r, viewport.value, bubbleHeight.value)
  return { top: p.top + 'px', left: p.left + 'px', width: p.width + 'px' }
})

function measure(): void {
  if (typeof window === 'undefined') return
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  const el = step.value ? document.querySelector(step.value.target) : null
  hole.value = el ? spotlightRect(el.getBoundingClientRect(), viewport.value) : null
  const value = bubbleEl.value as { $el?: unknown } | null
  const node = value?.$el ?? value
  if (node instanceof HTMLElement) bubbleHeight.value = node.offsetHeight
}

function focusStep(): void {
  if (typeof document === 'undefined' || !props.open) return
  const el = step.value ? document.querySelector(step.value.target) : null
  el?.scrollIntoView({ block: 'center', behavior: motionEnabled.value ? 'smooth' : 'auto' })
  void nextTick(() => {
    measure()
    // 平滑滚动结束后再量一次。
    setTimeout(measure, 360)
  })
}

function attach(on: boolean): void {
  if (typeof window === 'undefined') return
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('resize', measure)
  window[method]('scroll', measure, true)
}

watch(
  () => [props.open, props.index] as const,
  ([open], previous) => {
    if (open !== previous?.[0]) attach(open)
    if (open) focusStep()
  },
  { immediate: true },
)
onBeforeUnmount(() => attach(false))

function next(): void {
  const following = coachmarkNext(props.index, props.steps.length)
  if (following === null) {
    emit('done')
    return
  }
  emit('next', following)
  emit('update:index', following)
}
</script>

<template>
  <view v-if="open && step" class="pg-coach" role="dialog" aria-modal="true" :aria-label="step.title" data-testid="coachmark">
    <view class="pg-coach__blocker" />
    <view v-if="hole" class="pg-coach__hole" :style="holeStyle" />
    <view v-else class="pg-coach__dim" />
    <view ref="bubbleEl" class="pg-coach__bubble" :style="bubbleStyle">
      <view class="pg-coach__head">
        <PgMascot expr="happy" motion="blink" :size="56" />
        <view class="pg-coach__text">
          <text class="pg-coach__title">{{ step.title }}</text>
          <text v-if="step.body" class="pg-coach__body">{{ step.body }}</text>
        </view>
      </view>
      <view class="pg-coach__actions">
        <text class="pg-coach__count">{{ index + 1 }} / {{ steps.length }}</text>
        <PgButton v-if="!isLast" variant="ghost" size="sm" data-testid="coachmark-skip" @tap="emit('skip')">{{ skipText }}</PgButton>
        <PgButton size="sm" data-testid="coachmark-next" @tap="next">{{ isLast ? doneText : nextText }}</PgButton>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-coach { position: fixed; inset: 0; z-index: 85; }
.pg-coach__blocker { position: absolute; inset: 0; }
.pg-coach__dim { position: absolute; inset: 0; background: var(--mask-strong); }
/* 洞：向外的巨大阴影就是遮罩；形状变化时一起过渡 */
.pg-coach__hole {
  position: absolute;
  border-radius: var(--radius-16);
  box-shadow: 0 0 0 100vmax var(--mask-strong);
  transition: top var(--dur-slow) var(--ease-out), left var(--dur-slow) var(--ease-out), width var(--dur-slow) var(--ease-out), height var(--dur-slow) var(--ease-out);
  pointer-events: none;
}
.pg-coach__bubble {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: var(--bw) solid var(--rule);
  border-bottom-width: calc(var(--bw) + var(--lip) - 2px);
  border-radius: var(--radius-16);
  background: var(--sheet);
  transition: top var(--dur-slow) var(--ease-out), left var(--dur-slow) var(--ease-out);
}
.pg-coach__head { display: flex; align-items: flex-start; gap: var(--sp-3); }
.pg-coach__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-coach__title { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-coach__body { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.55; }
.pg-coach__actions { display: flex; align-items: center; gap: var(--sp-2); }
.pg-coach__count { margin-right: auto; color: var(--ink-2); font-size: var(--fs-12); font-variant-numeric: tabular-nums; }
</style>
