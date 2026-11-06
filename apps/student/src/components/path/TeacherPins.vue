<script setup lang="ts">
/** 老师布置：置顶在路径上面，带截止时间。接口只给开放中、没做完的；未开放的也说明原因，不让点。 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import TagChip from '@/components/TagChip.vue'
import { PATH_COPY, layerName } from '@/copy'
import type { AssignmentCardView } from '@/types/attempt'
import { formatDateTime } from '@/utils/date'
import { deadlineView } from './pathLogic'

const props = defineProps<{ cards: readonly AssignmentCardView[] }>()
defineEmits<{ (e: 'go', card: AssignmentCardView): void }>()

const rows = computed(() =>
  props.cards.map((card) => ({
    card,
    deadline: deadlineView(card.closeAt),
    open: card.status === 'open',
    note:
      card.status === 'scheduled'
        ? card.openAt
          ? `${formatDateTime(card.openAt)} 开放`
          : '等老师开放'
        : card.currentLayer
          ? `做到“${layerName(card.currentLayer)}”`
          : '',
  })),
)
</script>

<template>
  <view v-if="cards.length" class="pg-pins" data-testid="home-teacher-pins">
    <text class="pg-pins__head">{{ PATH_COPY.teacherPins }}</text>
    <PgCard v-for="(row, i) in rows" :key="row.card.assignmentId" class="pg-pin" data-testid="home-teacher-card" :data-assignment-id="row.card.assignmentId">
      <view class="pg-pin__icon"><PgIcon name="flag" :size="22" /></view>
      <view class="pg-pin__main">
        <MathText class="pg-pin__title" :text="row.card.title" />
        <view class="pg-pin__meta">
          <TagChip v-if="row.card.mode === 'test'" tone="fox">测验</TagChip>
          <text v-if="row.note" class="pg-pin__note">{{ row.note }}</text>
          <text v-if="row.deadline" class="pg-pin__due" :class="{ 'pg-pin__due--soon': row.deadline.soon }" data-testid="home-teacher-due">
            <PgIcon name="clock" :size="14" class="pg-pin__clock" />{{ row.deadline.text }}
          </text>
        </view>
      </view>
      <PgButton
        class="pg-pin__go"
        variant="secondary"
        size="sm"
        sound="tap"
        :disabled="!row.open"
        :data-testid="'home-teacher-start-' + i"
        :aria-label="(row.card.attemptId ? '继续 ' : '开始 ') + row.card.title"
        @tap="$emit('go', row.card)"
      >
        {{ row.card.attemptId ? PATH_COPY.action.continue : PATH_COPY.action.start }}
      </PgButton>
    </PgCard>
  </view>
</template>

<style scoped>
.pg-pins { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-pins__head { color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-pin { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3); }
.pg-pin__icon {
  flex: none;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-12);
  background: var(--sea-soft);
  color: var(--sea-text);
}
.pg-pin__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-pin__title { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.35; overflow-wrap: anywhere; }
.pg-pin__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px var(--sp-2); }
.pg-pin__note { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.4; }
.pg-pin__due { display: inline-flex; align-items: center; gap: 3px; color: var(--ink-2); font-size: var(--fs-13); line-height: 1.4; font-variant-numeric: tabular-nums; }
.pg-pin__due--soon { color: var(--fox-text); font-weight: var(--fw-heavy); }
.pg-pin__clock { flex: none; }
.pg-pin__go { flex: none; }
</style>
