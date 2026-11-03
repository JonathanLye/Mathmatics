<script setup lang="ts">
// 占位实现：由 #15 负责人替换为识别确认面板。
import MathText from './MathText.vue'
import type { Recognition } from '../../../apps/student/src/types/attempt'
const props = defineProps<{ recognition: Recognition; busy?: boolean }>()
const emit = defineEmits<{
  (e: 'confirm', text: string): void
  (e: 'rewrite'): void
  (e: 'edit-keyboard', text: string): void
  (e: 'discard'): void
}>()
</script>
<template>
  <view class="ui-recognition">
    <text class="ui-recognition__title">识别结果 · 请核对</text>
    <MathText :text="props.recognition.text || ''" block />
    <view class="ui-recognition__actions">
      <button class="ui-recognition__btn" @tap="emit('rewrite')">重写</button>
      <button class="ui-recognition__btn" @tap="emit('edit-keyboard', props.recognition.text || '')">改一下</button>
      <button class="ui-recognition__btn ui-recognition__btn--primary" @tap="emit('confirm', props.recognition.text || '')">确认</button>
    </view>
  </view>
</template>
<style>
.ui-recognition { background: var(--sheet, #fff); border-radius: var(--radius-card, 10px); padding: 16px; }
.ui-recognition__title { font-size: 13px; color: var(--ink-2, #5d6878); }
.ui-recognition__actions { display: flex; gap: 8px; margin-top: 12px; }
.ui-recognition__btn { flex: 1; min-height: 44px; border: 1px solid var(--rule, #e2e4e8); border-radius: var(--radius-input, 6px); background: var(--sheet, #fff); color: var(--ink, #1d2430); }
.ui-recognition__btn--primary { border-color: var(--accent, #2b4fa3); color: var(--accent, #2b4fa3); }
</style>
