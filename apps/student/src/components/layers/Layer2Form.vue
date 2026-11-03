<script setup lang="ts">
// #8 占位：正式 L2 表单在 #11 实现。
import MathText from '@ui-math/MathText.vue'
import type { FrameView } from '@/types/attempt'
const props = withDefaults(defineProps<{ layer?: string; view?: FrameView; busy?: boolean }>(), { layer: 'L2', view: () => ({}), busy: false })
const emit = defineEmits<{ (e: 'submit', text: string): void; (e: 'lesson'): void; (e: 'skip'): void }>()
</script>
<template>
  <view class="pg-placeholder pg-sheet">
    <text class="pg-placeholder__title">第 2 层 · 证明骨架</text>
    <MathText :text="props.view.task || '（任务说明在 #11 接入）'" block />
    <MathText v-if="props.view.template" :text="props.view.template" block />
    <text class="pg-placeholder__hint pg-small">本层表单在 #11 实现；#8 先保证工程/路由/MathText 可跑。</text>
    <view class="pg-placeholder__row">
      <button class="pg-placeholder__btn" @tap="emit('lesson')">看通用骨架</button>
      <button class="pg-placeholder__btn" @tap="emit('skip')">跳过</button>
    </view>
  </view>
</template>
<style scoped>
.pg-placeholder { padding: var(--sp-3); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-placeholder__title { font-family: var(--font-serif); font-weight: 600; }
.pg-placeholder__text { color: var(--ink); }
.pg-placeholder__hint { color: var(--ink-2); }
.pg-placeholder__row { display: flex; gap: var(--sp-2); }
.pg-placeholder__btn { min-height: 44px; padding: 0 var(--sp-3); border: 1px solid var(--rule); border-radius: var(--radius-input); background: var(--sheet); color: var(--ink); }
</style>
