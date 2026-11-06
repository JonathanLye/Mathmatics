<script setup lang="ts">
/**
 * 全屏庆祝层：小方欢呼 + 撒花 + 插槽（奖励数字、按钮）。
 * 打开时才撒花和响铃；是否允许由 useFeedbackPrefs 决定（测验模式、减少动态效果都会拦住）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import PgMascot from './PgMascot.vue'
import { clearConfetti, fireConfetti } from '@/motion/confetti'
import { playSfx } from '@/motion/sfx'
import { vibrate } from '@/motion/haptics'
import type { MascotExpr } from './icons'

const props = withDefaults(defineProps<{ open: boolean; title?: string; expr?: MascotExpr; confetti?: boolean; size?: number }>(), {
  title: '',
  expr: 'cheer',
  confetti: true,
  size: 144,
})

const canvas = ref<HTMLCanvasElement | null>(null)

watch(
  () => props.open,
  (open, wasOpen) => {
    if (open) {
      void nextTick(() => {
        if (props.confetti) void fireConfetti(canvas.value)
        playSfx('celebrate')
        vibrate('celebrate')
      })
    } else if (wasOpen) {
      clearConfetti(canvas.value)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => clearConfetti(canvas.value))
</script>

<template>
  <Transition name="pg-celebrate">
    <view v-if="open" class="pg-celebrate" role="dialog" aria-modal="true" :aria-label="title" data-testid="celebration">
      <canvas ref="canvas" class="pg-celebrate__canvas" aria-hidden="true" />
      <view class="pg-celebrate__body">
        <PgMascot :expr="expr" motion="cheer" :size="size" />
        <text v-if="title" class="pg-celebrate__title">{{ title }}</text>
        <slot />
        <view v-if="$slots.actions" class="pg-celebrate__actions"><slot name="actions" /></view>
      </view>
    </view>
  </Transition>
</template>

<style scoped>
.pg-celebrate {
  position: fixed;
  inset: 0;
  z-index: 88;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(var(--safe-top) + var(--sp-6)) var(--sp-6) calc(var(--safe-bottom) + var(--sp-6));
  background: var(--paper);
  overflow-y: auto;
}
.pg-celebrate__canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.pg-celebrate__body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  max-width: var(--form-max);
  color: var(--ink);
  text-align: center;
}
.pg-celebrate__title { font-size: var(--fs-28); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-celebrate__actions { display: flex; flex-direction: column; gap: var(--sp-3); width: 100%; margin-top: var(--sp-4); }
.pg-celebrate-enter-active { transition: opacity var(--dur-base) ease-out; }
.pg-celebrate-enter-active .pg-celebrate__body { transition: transform var(--dur-slow) var(--ease-spring); }
.pg-celebrate-leave-active { transition: opacity var(--dur-base) ease-in; }
.pg-celebrate-enter-from,
.pg-celebrate-leave-to { opacity: 0; }
.pg-celebrate-enter-from .pg-celebrate__body { transform: scale(0.86); }
</style>
