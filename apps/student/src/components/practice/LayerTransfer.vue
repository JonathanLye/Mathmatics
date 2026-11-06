<script setup lang="ts">
/** 第 5 层屏：父作答的入口（TransferForm）或迁移题子作答（TransferAttempt）。 */
import TransferAttempt from '@/components/layers/TransferAttempt.vue'
import TransferForm from '@/components/layers/TransferForm.vue'
import type { Note, ProblemView, ProofLine, TransferView } from '@/types/attempt'
import type { TransferDraft } from '@/composables/practice/useAttemptSession'

defineProps<{
  /** 子作答（kind=transfer）时为 true。 */
  child?: boolean
  view?: TransferView | null
  problem: ProblemView
  lines?: ProofLine[]
  notes?: Note[]
  canFinish?: boolean
  busy?: boolean
}>()
defineEmits<{
  (e: 'start'): void
  (e: 'skip'): void
  (e: 'add-line', draft: TransferDraft): void
  (e: 'edit-line', lineId: string, draft: TransferDraft): void
  (e: 'delete-line', lineId: string): void
  (e: 'finish'): void
  (e: 'dismiss-note', noteId: string): void
}>()
</script>

<template>
  <TransferAttempt
    v-if="child"
    :problem="problem"
    :lines="lines"
    :notes="notes"
    :can-finish="canFinish"
    :busy="busy"
    @add-line="$emit('add-line', $event)"
    @edit-line="(lineId, draft) => $emit('edit-line', lineId, draft)"
    @delete-line="$emit('delete-line', $event)"
    @finish="$emit('finish')"
    @dismiss-note="$emit('dismiss-note', $event)"
  />
  <TransferForm v-else :view="view ?? null" :busy="busy" @start="$emit('start')" @skip="$emit('skip')" />
</template>
