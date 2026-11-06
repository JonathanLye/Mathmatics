<script setup lang="ts">
/** 单元横幅：上面一行选章节和单元，中间是单元名，右边是“单元讲义”。滚动时吸顶，随时知道自己在哪。写完这个单元变成金色。 */
import { computed } from 'vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import { PATH_COPY } from '@/copy'
import type { PathUnitDetail } from '@/types/path'

const props = defineProps<{ unit: PathUnitDetail; chapter: string; ordinal: number }>()
defineEmits<{ (e: 'notes'): void; (e: 'chapters'): void }>()

const done = computed(() => props.unit.total > 0 && props.unit.done >= props.unit.total)
</script>

<template>
  <view class="pg-banner" :class="{ 'pg-banner--done': done }" data-testid="home-unit-banner">
    <view class="pg-banner__main">
      <view class="pg-banner__chapter" role="button" tabindex="0" data-testid="home-chapter-picker" :aria-label="PATH_COPY.chapterSheet" @tap="$emit('chapters')" @keydown.enter.prevent="$emit('chapters')">
        <text class="pg-banner__kicker">{{ PATH_COPY.unitKicker(chapter, ordinal) }}</text>
        <PgIcon name="chevron" :size="14" class="pg-banner__chevron" />
      </view>
      <text class="pg-banner__title">{{ unit.title }}</text>
      <view class="pg-banner__progress" aria-hidden="true">
        <view class="pg-banner__bar"><view class="pg-banner__fill" :style="{ width: (unit.total > 0 ? (unit.done / unit.total) * 100 : 0) + '%' }" /></view>
        <text class="pg-banner__count">{{ PATH_COPY.unitCount(unit.done, unit.total) }}</text>
      </view>
    </view>
    <PgButton class="pg-banner__notes" variant="secondary" size="sm" stack sound="tap" data-testid="home-unit-notes" @tap="$emit('notes')">
      <PgIcon name="book" :size="24" />
      <text class="pg-banner__noteslabel">{{ PATH_COPY.notes }}</text>
    </PgButton>
  </view>
</template>

<style scoped>
.pg-banner {
  --_face: var(--accent);
  --_lip: var(--accent-lip);
  --_ink: var(--on-accent);
  position: sticky;
  top: calc(var(--safe-top) + var(--sp-2));
  z-index: 6;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--lip);
  padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4);
  border-radius: var(--radius-16);
  background: var(--_face);
  color: var(--_ink);
  box-shadow: 0 var(--lip) 0 var(--_lip);
  transition: background-color var(--dur-slow) ease-out;
}
.pg-banner--done { --_face: var(--bee); --_lip: var(--bee-lip); --_ink: var(--on-bee); }
.pg-banner__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-banner__chapter {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 2px;
  max-width: 100%;
  min-height: var(--touch);
  margin: -8px 0;
  cursor: pointer;
}
.pg-banner__chapter:active { opacity: 0.7; }
.pg-banner__kicker { min-width: 0; overflow: hidden; font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.pg-banner__chevron { flex: none; transform: rotate(90deg); }
.pg-banner__title { font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); overflow-wrap: anywhere; }
.pg-banner__progress { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-1); }
.pg-banner__bar { flex: 1; max-width: 180px; height: 8px; overflow: hidden; border-radius: var(--radius-pill); background: var(--_lip); }
.pg-banner__fill { height: 100%; border-radius: var(--radius-pill); background: var(--sheet); transition: width var(--dur-slow) var(--ease-out); }
.pg-banner__count { font-size: var(--fs-12); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; }
.pg-banner__notes.pg-button {
  flex: none;
  width: 72px;
  min-height: 64px;
  margin-bottom: 3px;
  border-color: transparent;
  box-shadow: 0 3px 0 var(--_lip);
  color: var(--ink);
}
.pg-banner__notes.pg-button:active:not([disabled]) { transform: translateY(3px); box-shadow: none; }
.pg-banner__noteslabel { font-size: var(--fs-12); font-weight: var(--fw-black); line-height: 1.2; white-space: nowrap; }
</style>
