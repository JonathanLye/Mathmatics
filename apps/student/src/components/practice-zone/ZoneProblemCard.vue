<script setup lang="ts">
/** 练习区的一张题卡：可点、有下唇。难度和状态都有自己的颜色。 */
import MathText from '@ui-math/MathText.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import TagChip from '@/components/TagChip.vue'
import { AI_IMPORTED_TAG, DIFFICULTY_TONE, STATUS_LABEL, ZONE_COPY } from '@/copy'
import { playSfx } from '@/motion/sfx'
import { DIFFICULTY_LABEL, type PracticeItem } from '@/types/path'

defineProps<{ item: PracticeItem }>()
const emit = defineEmits<{ (e: 'open'): void }>()

function open(): void {
  playSfx('tap')
  emit('open')
}
</script>

<template>
  <PgCard
    class="pg-zonecard"
    :class="{ 'pg-zonecard--done': item.status === 'done' }"
    lip
    role="button"
    tabindex="0"
    data-testid="zone-card"
    :data-problem-id="item.problemId"
    :data-difficulty="item.difficulty"
    :data-status="item.status"
    @tap="open"
    @keydown.enter.prevent="open"
  >
    <view class="pg-zonecard__tags">
      <TagChip :tone="DIFFICULTY_TONE[item.difficulty]" data-testid="zone-card-difficulty">{{ DIFFICULTY_LABEL[item.difficulty] }}</TagChip>
      <TagChip v-if="item.status === 'active'" tone="accent" data-testid="zone-card-status">{{ STATUS_LABEL.active }}</TagChip>
      <TagChip v-else-if="item.status === 'done'" tone="bee" data-testid="zone-card-status">{{ STATUS_LABEL.done }}</TagChip>
      <TagChip v-if="item.autoImported" data-testid="zone-card-ai">{{ AI_IMPORTED_TAG }}</TagChip>
      <view v-if="item.status === 'done'" class="pg-zonecard__check"><PgIcon name="check" :size="16" /></view>
    </view>
    <MathText class="pg-zonecard__title" :text="item.title" />
    <MathText class="pg-zonecard__stem" :text="item.stemPreview" block />
    <text class="pg-zonecard__meta">{{ item.chapter }}<text v-if="item.keyCount"> · {{ ZONE_COPY.keyCount(item.keyCount) }}</text></text>
  </PgCard>
</template>

<style scoped>
.pg-zonecard {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  cursor: pointer;
  transition: transform var(--dur-base) var(--ease-spring), border-color var(--dur-fast) ease-out;
}
.pg-zonecard:active { transform: translateY(2px); transition-duration: var(--dur-fast); }
.pg-zonecard:hover { border-color: var(--rule-2); }
.pg-zonecard__tags { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-1); }
.pg-zonecard__check {
  width: 24px;
  height: 24px;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bee);
  color: var(--on-bee);
}
.pg-zonecard__title { margin-top: var(--sp-1); color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); line-height: 1.35; overflow-wrap: anywhere; }
.pg-zonecard__stem { min-width: 0; color: var(--ink-2); font-size: var(--fs-13); line-height: 1.55; overflow-wrap: anywhere; }
.pg-zonecard__meta { margin-top: var(--sp-1); color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); line-height: 1.3; }
</style>
