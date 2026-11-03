<script setup lang="ts">
// #8 占位：正式行编辑器在 #12/#15 实现（MathTextEditor + 证明键盘 + 手写）。
import type { InputProvenance } from '@/types/attempt'
const props = withDefaults(defineProps<{ open?: boolean; lineNo?: number; initialStatement?: string; initialJustification?: string; busy?: boolean }>(), { open: false, lineNo: 1, initialStatement: '', initialJustification: '', busy: false })
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'submit', d: { statement: string; justification: string; input: { provenance: InputProvenance; draftId: string } }): void; (e: 'request-recognition'): void }>()
function onSubmit() {
  emit('update:open', false)
}
</script>
<template>
  <view v-if="props.open" class="pg-editormask" @tap="emit('update:open', false)">
    <view class="pg-editor" @tap.stop>
      <text class="pg-editor__title">第 {{ props.lineNo }} 行</text>
      <text class="pg-editor__hint pg-small">正式行编辑器在 #12/#15 实现（MathText 编辑器 + 证明键盘 + 手写 + 识别确认）。</text>
      <button class="pg-editor__btn" @tap="onSubmit">关闭</button>
    </view>
  </view>
</template>
<style scoped>
.pg-editormask { position: fixed; inset: 0; z-index: 65; background: rgba(29,36,48,.35); display: flex; align-items: flex-end; }
.pg-editor { width: 100%; background: var(--sheet); border-radius: var(--radius-sheet) var(--radius-sheet) 0 0; padding: var(--sp-3) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom)); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-editor__title { font-family: var(--font-serif); font-weight: 600; }
.pg-editor__hint { color: var(--ink-2); }
.pg-editor__btn { min-height: 44px; border: 0; background: var(--accent); color: #fff; border-radius: var(--radius-input); }
</style>
