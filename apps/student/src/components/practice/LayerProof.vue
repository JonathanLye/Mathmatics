<script setup lang="ts">
/** 第 3 层屏：证明轨道 + 轨道下面唯一的「写下一行」。关键步骤写全了，「写完了」才出现并贴底。 */
import { computed, nextTick, watch } from 'vue'
import ProofLineList from '@/components/layers/ProofLineList.vue'
import PgButton from '@/components/ui/PgButton.vue'
import { useViewport } from '@/composables/useViewport'
import type { Note, ProofLine } from '@/types/attempt'

const props = defineProps<{
  lines: ProofLine[]
  notes: Note[]
  busy?: boolean
  canFinish?: boolean
  matchedLineIds?: string[]
}>()
defineEmits<{
  (e: 'write-next'): void
  (e: 'edit-line', line: ProofLine): void
  (e: 'delete-line', line: ProofLine): void
  (e: 'dismiss-note', noteId: string): void
  (e: 'finish'): void
}>()

const { mode } = useViewport()
/** 桌面批注在右边的页边；手机和平板挂在行下面。 */
const noteLayout = computed(() => (mode.value === 'desktop' ? 'margin' : 'inline'))

// 新写的一行滚到反馈面板上方，学生能看到它落在轨道上。
watch(
  () => props.lines.length,
  (now, before) => {
    if (now <= before || typeof document === 'undefined') return
    const lineId = props.lines.at(-1)?.lineId
    void nextTick(() => {
      const row = lineId ? document.querySelector('[data-line-id="' + CSS.escape(lineId) + '"]') : null
      row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    })
  },
)
</script>

<template>
  <ProofLineList
    rail
    editable
    animate
    :lines="lines"
    :notes="notes"
    :busy="busy"
    :matched-line-ids="matchedLineIds"
    :note-layout="noteLayout"
    @write-next="$emit('write-next')"
    @edit-line="$emit('edit-line', $event)"
    @delete-line="$emit('delete-line', $event)"
    @dismiss-note="$emit('dismiss-note', $event)"
  />
  <view v-if="canFinish" class="pg-pin pg-proof__finish">
    <PgButton block size="lg" data-testid="finish-steps" sound="tap" :loading="busy" @tap="$emit('finish')">写完了</PgButton>
  </view>
</template>

<style scoped>
.pg-proof__finish { margin-top: var(--sp-4); animation: pg-item-in var(--dur-slow) var(--ease-out) both; }
@media (min-width: 600px) {
  .pg-proof__finish { max-width: var(--form-max); }
}
@media (max-width: 599px) {
  .pg-proof__finish { margin-top: 0; animation: none; }
}
</style>
