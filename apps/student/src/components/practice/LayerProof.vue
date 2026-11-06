<script setup lang="ts">
/** 第 3 层屏：证明行列表 + 识别草稿 + 「写完了」。 */
import MathText from '@ui-math/MathText.vue'
import ProofLineList from '@/components/layers/ProofLineList.vue'
import PgButton from '@/components/ui/PgButton.vue'
import type { Note, ProofLine } from '@/types/attempt'

defineProps<{
  lines: ProofLine[]
  notes: Note[]
  busy?: boolean
  canFinish?: boolean
  /** #15：拍照识别确认后的结果先作为「这一行」的草稿显示，学生确认/再改后才提交。 */
  recogDraft?: { text: string } | null
}>()
defineEmits<{
  (e: 'write-next'): void
  (e: 'dismiss-note', noteId: string): void
  (e: 'finish'): void
  (e: 'clear-draft'): void
}>()
</script>

<template>
  <view v-if="recogDraft" class="pg-practice__draft pg-sheet" :data-draft-text="recogDraft.text">
    <view class="pg-practice__drafthead">
      <text class="pg-practice__drafttitle">识别结果（已确认）</text>
      <text class="pg-practice__draftmeta pg-small">已放入这一行草稿</text>
    </view>
    <view class="pg-practice__drafttext">
      <MathText :text="recogDraft.text" block />
    </view>
    <view class="pg-practice__draftrow">
      <PgButton class="pg-practice__draftbtn--continue" variant="secondary" size="sm" @tap="$emit('write-next')">用键盘继续改</PgButton>
      <PgButton class="pg-practice__draftbtn--clear" variant="ghost" size="sm" @tap="$emit('clear-draft')">清除草稿</PgButton>
    </view>
  </view>
  <ProofLineList :lines="lines" :notes="notes" :busy="busy" @write-next="$emit('write-next')" @dismiss-note="$emit('dismiss-note', $event)" />
  <view class="pg-practice__finishrow">
    <PgButton size="lg" data-testid="finish-steps" sound="tap" :disabled="!canFinish || busy" @tap="$emit('finish')">写完了</PgButton>
  </view>
</template>

<style scoped>
.pg-practice__finishrow {
  display: flex;
  justify-content: flex-end;
  padding: var(--sp-3) 0 var(--sp-2);
}
/* #15 拍照识别：确认后的草稿卡（02 §4.5/§4.6） */
.pg-practice__draft {
  margin-bottom: var(--sp-2);
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  border-color: var(--accent);
}
.pg-practice__drafthead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}
.pg-practice__drafttitle {
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  color: var(--ink);
}
.pg-practice__draftmeta { color: var(--ink-2); }
.pg-practice__drafttext {
  padding: var(--sp-2);
  border-radius: var(--radius-12);
  background: var(--paper);
  color: var(--ink);
}
.pg-practice__draftrow { display: flex; gap: var(--sp-2); }
</style>
