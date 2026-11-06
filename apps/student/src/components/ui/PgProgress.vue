<script setup lang="ts">
/**
 * 进度条。传 segments 是分段（六层、微课步骤），传 value（0–1）是连续。
 * 往前走时闪一下光；回退和初次渲染不闪。seg-class 给每段加业务类名（e2e 和旧样式用）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { clampProgress, segmentsProgress, shouldShine, type SegmentState } from './uiLogic'

const props = withDefaults(
  defineProps<{ segments?: readonly SegmentState[] | null; value?: number; segClass?: string; tone?: 'accent' | 'bee'; label?: string }>(),
  { segments: null, value: 0, segClass: '', tone: 'accent', label: '进度' },
)

const pct = computed(() => clampProgress(props.value) * 100)
const amount = computed(() => (props.segments ? segmentsProgress(props.segments) : clampProgress(props.value)))
const shining = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

watch(amount, (next, previous) => {
  if (!shouldShine(previous ?? null, next)) return
  shining.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    shining.value = false
  }, 900)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <view
    class="pg-progress"
    :class="['pg-progress--' + tone, { 'pg-progress--shining': shining }]"
    role="progressbar"
    :aria-label="label"
    :aria-valuenow="segments ? amount : Math.round(pct)"
    :aria-valuemin="0"
    :aria-valuemax="segments ? segments.length : 100"
  >
    <template v-if="segments">
      <view v-for="(state, i) in segments" :key="i" class="pg-progress__seg" :class="['pg-progress__seg--' + state, segClass]">
        <view class="pg-progress__fill" />
      </view>
    </template>
    <view v-else class="pg-progress__seg">
      <view class="pg-progress__fill" :style="{ width: pct + '%' }" />
    </view>
  </view>
</template>

<style scoped>
.pg-progress { --_fill: var(--accent); display: flex; gap: var(--sp-1); width: 100%; min-width: 0; }
.pg-progress--bee { --_fill: var(--bee); }
.pg-progress__seg {
  position: relative;
  flex: 1;
  height: 14px;
  border-radius: var(--radius-pill);
  background: var(--rule);
  overflow: hidden;
}
.pg-progress__fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  border-radius: var(--radius-pill);
  background: var(--_fill);
  overflow: hidden;
  transition: width var(--dur-slow) var(--ease-out);
}
/* 顶部高光：厚边积木的手感 */
.pg-progress__fill::before {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  top: 3px;
  height: 3px;
  border-radius: var(--radius-pill);
  background: var(--shine);
}
.pg-progress__seg--done .pg-progress__fill,
.pg-progress__seg--skipped .pg-progress__fill { width: 100%; }
.pg-progress__seg--active .pg-progress__fill { width: 50%; }
.pg-progress__seg--skipped .pg-progress__fill { opacity: 0.45; }
.pg-progress__seg--off { opacity: 0.5; }

/* 前进时的闪光 */
.pg-progress--shining .pg-progress__fill::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--shine), transparent);
  animation: pg-shine-sweep 800ms var(--ease-out) 1;
}
</style>
