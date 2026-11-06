<script setup lang="ts">
/** 章节跳转：按章列出所有单元。没解锁的单元也能点（页面弹确认），不硬拦。 */
import { computed } from 'vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import { PATH_COPY } from '@/copy'
import type { PathChapter, PathUnitSummary } from '@/types/path'

const props = defineProps<{ open: boolean; chapters: readonly PathChapter[]; units: readonly PathUnitSummary[]; currentId: string | null }>()
defineEmits<{ (e: 'update:open', value: boolean): void; (e: 'pick', unit: PathUnitSummary): void }>()

const groups = computed(() =>
  props.chapters.map((chapter) => ({ chapter, units: props.units.filter((unit) => unit.chapterNo === chapter.chapterNo) })),
)
</script>

<template>
  <PgSheet :open="open" data-testid="home-chapter-sheet" :aria-label="PATH_COPY.chapterSheet" @update:open="$emit('update:open', $event)">
    <text class="pg-chapters__title">{{ PATH_COPY.chapterSheet }}</text>
    <view v-for="group in groups" :key="group.chapter.chapterNo" class="pg-chapters__group">
      <view class="pg-chapters__head">
        <text class="pg-chapters__name">{{ group.chapter.chapter }}</text>
        <text class="pg-chapters__count">{{ PATH_COPY.unitCount(group.chapter.done, group.chapter.total) }}</text>
      </view>
      <view
        v-for="unit in group.units"
        :key="unit.id"
        class="pg-chapters__row"
        :class="{ 'pg-chapters__row--on': unit.id === currentId }"
        role="button"
        tabindex="0"
        data-testid="home-unit-row"
        :data-unit-id="unit.id"
        :data-locked="unit.locked ? 'true' : undefined"
        :aria-current="unit.id === currentId ? 'true' : undefined"
        @tap="$emit('pick', unit)"
        @keydown.enter.prevent="$emit('pick', unit)"
      >
        <view class="pg-chapters__badge" :class="unit.state === 'done' ? 'pg-chapters__badge--done' : unit.locked ? 'pg-chapters__badge--locked' : 'pg-chapters__badge--open'">
          <PgIcon :name="unit.state === 'done' ? 'check' : unit.locked ? 'lock' : 'pen'" :size="18" />
        </view>
        <view class="pg-chapters__main">
          <text class="pg-chapters__unit">{{ unit.title }}</text>
          <text class="pg-chapters__sub">{{ PATH_COPY.notesProgress(unit.done, unit.total) }}</text>
        </view>
        <PgIcon name="chevron" :size="16" class="pg-chapters__chevron" />
      </view>
    </view>
  </PgSheet>
</template>

<style scoped>
.pg-chapters__title { margin-top: var(--sp-1); color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-chapters__group { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-chapters__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); padding: var(--sp-1) var(--sp-1) 0; }
.pg-chapters__name { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-chapters__count { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); font-variant-numeric: tabular-nums; }
.pg-chapters__row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 56px;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-12);
  background: var(--sheet);
  cursor: pointer;
  transition: transform var(--dur-base) var(--ease-spring);
}
.pg-chapters__row:active { transform: scale(0.98); transition-duration: var(--dur-fast); }
.pg-chapters__row--on { border-color: var(--accent); background: var(--accent-soft); }
.pg-chapters__badge { flex: none; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
.pg-chapters__badge--done { background: var(--bee); color: var(--on-bee); }
.pg-chapters__badge--open { background: var(--accent); color: var(--on-accent); }
.pg-chapters__badge--locked { background: var(--rule); color: var(--ink-2); }
.pg-chapters__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pg-chapters__unit { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-heavy); line-height: 1.3; }
.pg-chapters__sub { color: var(--ink-2); font-size: var(--fs-12); line-height: 1.3; }
.pg-chapters__chevron { flex: none; color: var(--ink-2); }
</style>
