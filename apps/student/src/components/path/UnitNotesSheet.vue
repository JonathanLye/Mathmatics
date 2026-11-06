<script setup lang="ts">
/** 单元讲义：这个单元讲什么、涉及哪些概念、做到哪了。 */
import MathText from '@ui-math/MathText.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { PATH_COPY } from '@/copy'
import type { PathUnitDetail } from '@/types/path'

defineProps<{ open: boolean; unit: PathUnitDetail | null; chapter: string }>()
defineEmits<{ (e: 'update:open', value: boolean): void }>()
</script>

<template>
  <PgSheet :open="open" data-testid="unit-notes-sheet" :aria-label="PATH_COPY.notes" @update:open="$emit('update:open', $event)">
    <template v-if="unit">
      <text class="pg-notes__kicker">{{ PATH_COPY.unitKicker(chapter, unit.unitNo) }}</text>
      <text class="pg-notes__title">{{ unit.title }}</text>
      <MathText v-if="unit.summary" class="pg-notes__summary" :text="unit.summary" block data-testid="unit-notes-summary" />
      <view class="pg-notes__progress">
        <PgProgress :value="unit.total > 0 ? unit.done / unit.total : 0" tone="bee" :label="PATH_COPY.notes" />
        <text class="pg-notes__count">{{ PATH_COPY.notesProgress(unit.done, unit.total) }}</text>
      </view>
      <template v-if="unit.concepts.length">
        <text class="pg-notes__head">{{ PATH_COPY.notesConcepts }}</text>
        <PgCard v-for="concept in unit.concepts" :key="concept.id" class="pg-notes__concept" tone="soft" data-testid="unit-notes-concept">
          <view class="pg-notes__icon"><PgIcon name="book" :size="20" /></view>
          <MathText class="pg-notes__name" :text="concept.title" />
        </PgCard>
      </template>
    </template>
  </PgSheet>
</template>

<style scoped>
.pg-notes__kicker { margin-top: var(--sp-1); color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-notes__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-notes__summary { color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
.pg-notes__progress { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-notes__count { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-notes__head { margin-top: var(--sp-1); color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-notes__concept { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); }
.pg-notes__icon {
  flex: none;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.pg-notes__name { min-width: 0; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); }
</style>
