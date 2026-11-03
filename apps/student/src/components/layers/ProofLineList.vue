<script setup lang="ts">
// #8 占位：正式第 3 层行列表在 #12 实现。
import MathText from '@ui-math/MathText.vue'
import type { Note, ProofLine } from '@/types/attempt'
const props = withDefaults(defineProps<{ lines?: ProofLine[]; notes?: Note[]; busy?: boolean }>(), { lines: () => [], notes: () => [], busy: false })
const emit = defineEmits<{ (e: 'write-next'): void }>()
function notesFor(lineId: string) { return (props.notes || []).filter((n) => n.lineId === lineId) }
function fmt(n: number) { return String(n) }
</script>
<template>
  <view class="pg-lines">
    <view v-for="l in props.lines" :key="l.lineId" class="pg-lines__row">
      <text class="pg-lines__no pg-mono">{{ fmt(l.n) }}</text>
      <view class="pg-lines__body">
        <MathText :text="l.statement" block />
        <text class="pg-lines__just pg-small">依据 {{ l.justification || '（未写）' }}</text>
        <view v-for="n in notesFor(l.lineId)" :key="n.noteId" class="pg-lines__note">
          <text class="pg-lines__notewho pg-small">{{ n.who }}</text>
          <MathText :text="n.text" block />
        </view>
      </view>
    </view>
    <text v-if="props.lines.length === 0" class="pg-lines__empty pg-small">还没有写证明行（正式编辑在 #12 接入）。</text>
    <button class="pg-lines__add" @tap="emit('write-next')">＋ 写下一行</button>
  </view>
</template>
<style scoped>
.pg-lines { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-lines__row { display: flex; gap: var(--sp-2); padding: var(--sp-2); border-bottom: 1px solid var(--rule); }
.pg-lines__no { width: 24px; color: var(--ink-2); font-size: 12px; }
.pg-lines__body { flex: 1; min-width: 0; }
.pg-lines__just { color: var(--ink-2); }
.pg-lines__note { margin-top: var(--sp-1); padding: var(--sp-1) var(--sp-2); border-left: 3px solid var(--margin); background: var(--margin-soft); }
.pg-lines__notewho { display: block; color: var(--ink-2); }
.pg-lines__empty { color: var(--ink-2); }
.pg-lines__add { margin-top: var(--sp-2); min-height: 44px; border: 1px dashed var(--rule); border-radius: var(--radius-input); background: transparent; color: var(--accent); }
</style>
