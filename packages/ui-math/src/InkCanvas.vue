<script setup lang="ts">
// 占位实现：由 #14 负责人替换为 ink-v1 手写画布。
const props = withDefaults(defineProps<{ modelValue?: string; height?: number | string; readonly?: boolean }>(), {
  modelValue: '', height: '100%', readonly: false,
})
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'finish', v: string): void
  (e: 'draw-start'): void
}>()
</script>
<template>
  <view class="ui-ink-canvas" :style="{ height: typeof props.height === 'number' ? props.height + 'px' : props.height }">
    <text class="ui-ink-canvas__hint">（占位）手写画布 · ink-v1</text>
  </view>
</template>
<style>
.ui-ink-canvas {
  width: 100%;
  background: var(--sheet, #fff);
  border: 1px dashed var(--rule, #e2e4e8);
  border-radius: var(--radius-card, 10px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ui-ink-canvas__hint {
  color: var(--ink-2, #5d6878);
  font-size: 13px;
}
</style>
