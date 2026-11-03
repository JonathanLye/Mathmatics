<script setup lang="ts">
// 占位实现：由 #13 负责人替换为正式 MathText 编辑器（含证明键盘联动）。
const props = withDefaults(defineProps<{ modelValue?: string; placeholder?: string; keyboardOpen?: boolean; disabled?: boolean; minRows?: number }>(), {
  modelValue: '', placeholder: '', keyboardOpen: false, disabled: false, minRows: 3,
})
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'request-system-keyboard'): void
  (e: 'close-keyboard'): void
}>()
</script>
<template>
  <textarea
    class="ui-math-editor"
    :value="props.modelValue"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :rows="props.minRows"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
<style>
.ui-math-editor {
  width: 100%;
  border: 1px solid var(--rule, #e2e4e8);
  border-radius: var(--radius-input, 6px);
  background: var(--sheet, #fff);
  color: var(--ink, #1d2430);
  font-size: 16px;
  line-height: 1.65;
  padding: 10px 12px;
  resize: vertical;
}
</style>
