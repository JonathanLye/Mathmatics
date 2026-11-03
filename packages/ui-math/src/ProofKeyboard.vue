<script setup lang="ts">
// 占位实现：由 #13 负责人替换为按 contracts/keyboard-layout.json 渲染的证明键盘。
defineProps<{ visible: boolean; layout?: unknown }>()
const emit = defineEmits<{ (e: 'insert', p: { text: string; cursorOffset?: number }): void; (e: 'action', a: string): void }>()
</script>
<template>
  <view v-if="visible" class="ui-proof-keyboard" data-placeholder="ProofKeyboard">
    <text class="ui-proof-keyboard__hint" @tap="emit('action', 'done')">（占位）证明键盘 · 点此关闭</text>
  </view>
</template>
<style>
.ui-proof-keyboard {
  min-height: 96px;
  background: var(--sheet, #fff);
  border-top: 1px solid var(--rule, #e2e4e8);
  padding: 12px;
}
.ui-proof-keyboard__hint {
  color: var(--ink-2, #5d6878);
  font-size: 13px;
}
</style>
