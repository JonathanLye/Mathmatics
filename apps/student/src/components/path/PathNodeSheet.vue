<script setup lang="ts">
/**
 * 点节点弹出的卡片：题目、题面预览、六步进度、一个动作（开始 / 继续 / 回看）。
 * 软锁的节点不硬拦：说明一句，确认后可以跳过去。开始失败（比如这题班里正在测验）就在卡片里说明原因。
 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgProgress from '@/components/ui/PgProgress.vue'
import PgSheet from '@/components/ui/PgSheet.vue'
import TagChip from '@/components/TagChip.vue'
import { AI_IMPORTED_NOTE, AI_IMPORTED_TAG, SOURCE_OF, DIFFICULTY_TONE, PATH_COPY, STATUS_LABEL } from '@/copy'
import { DIFFICULTY_LABEL, type PathItem } from '@/types/path'
import { nodeAction, stepsFor } from './pathLogic'

const props = defineProps<{
  open: boolean
  item: PathItem | null
  busy: boolean
  error: string
}>()
defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'act'): void
  (e: 'review'): void
  (e: 'stay'): void
}>()

const steps = computed(() => (props.item ? stepsFor(props.item) : []))
const stepStates = computed(() => steps.value.map((step) => step.state))
const locked = computed(() => props.item?.softLocked === true && props.item.state === 'todo')
const actionText = computed(() => (props.item ? PATH_COPY.action[nodeAction(props.item)] : ''))
const canReview = computed(() => props.item?.state === 'done' && props.item.reviewPublished && Boolean(props.item.attemptId))
</script>

<template>
  <PgSheet :open="open" :persistent="busy" data-testid="node-sheet" :aria-label="item?.title" @update:open="$emit('update:open', $event)">
    <template v-if="item">
      <view class="pg-nodesheet__tags">
        <TagChip :tone="DIFFICULTY_TONE[item.difficulty]" data-testid="node-sheet-difficulty">{{ DIFFICULTY_LABEL[item.difficulty] }}</TagChip>
        <TagChip v-if="item.state === 'active'" tone="accent">{{ STATUS_LABEL.active }}</TagChip>
        <TagChip v-if="item.state === 'done'" tone="bee">{{ STATUS_LABEL.done }}</TagChip>
        <TagChip v-if="item.autoImported" data-testid="node-sheet-ai">{{ AI_IMPORTED_TAG }}</TagChip>
      </view>
      <MathText class="pg-nodesheet__title" :text="item.title" data-testid="node-sheet-title" />
      <MathText class="pg-nodesheet__stem" :text="item.stemPreview" block serif data-testid="node-sheet-stem" />
      <text v-if="item.sourceBook" class="pg-nodesheet__note" data-testid="node-sheet-source">{{ SOURCE_OF(item.sourceBook) }}</text>
      <text v-if="item.autoImported" class="pg-nodesheet__note">{{ AI_IMPORTED_NOTE }}</text>

      <view v-if="steps.length" class="pg-nodesheet__steps" data-testid="node-sheet-steps">
        <PgProgress :segments="stepStates" :label="PATH_COPY.stepsTitle" />
        <view v-if="steps[0].label" class="pg-nodesheet__stepnames" :style="{ gridTemplateColumns: 'repeat(' + steps.length + ', minmax(0, 1fr))' }">
          <text v-for="step in steps" :key="step.label" class="pg-nodesheet__stepname" :class="'pg-nodesheet__stepname--' + step.state">{{ step.label }}</text>
        </view>
      </view>

      <view v-if="locked" class="pg-nodesheet__locked" data-testid="node-sheet-locked">
        <PgIcon name="lock" :size="20" class="pg-nodesheet__lockicon" />
        <view class="pg-nodesheet__lockedtext">
          <text class="pg-nodesheet__lockedtitle">{{ PATH_COPY.lockedTitle }}</text>
          <text class="pg-nodesheet__lockedbody">{{ PATH_COPY.lockedBody }}</text>
        </view>
      </view>

      <text v-if="error" class="pg-nodesheet__error" role="alert" data-testid="node-sheet-error">{{ error }}</text>

      <view class="pg-nodesheet__actions">
        <template v-if="locked">
          <PgButton block size="lg" sound="tap" data-testid="node-sheet-stay" :disabled="busy" @tap="$emit('stay')">{{ PATH_COPY.lockedStay }}</PgButton>
          <PgButton block variant="secondary" sound="tap" data-testid="node-sheet-jump" :loading="busy" @tap="$emit('act')">{{ PATH_COPY.lockedJump }}</PgButton>
        </template>
        <template v-else>
          <PgButton block size="lg" sound="tap" data-testid="node-sheet-action" :loading="busy" @tap="$emit('act')">{{ actionText }}</PgButton>
          <PgButton v-if="canReview" block variant="secondary" sound="tap" data-testid="node-sheet-review" :disabled="busy" @tap="$emit('review')">{{ PATH_COPY.review }}</PgButton>
        </template>
      </view>
    </template>
  </PgSheet>
</template>

<style scoped>
.pg-nodesheet__tags { display: flex; flex-wrap: wrap; gap: var(--sp-1); margin-top: var(--sp-1); }
.pg-nodesheet__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); overflow-wrap: anywhere; }
.pg-nodesheet__stem { color: var(--ink); font-size: var(--fs-16); line-height: var(--lh-body); }
.pg-nodesheet__note { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-nodesheet__steps { display: flex; flex-direction: column; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--radius-12); background: var(--paper-2); }
.pg-nodesheet__stepnames { display: grid; gap: var(--sp-1); }
.pg-nodesheet__stepname { color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-bold); line-height: 1.25; text-align: center; }
.pg-nodesheet__stepname--active { color: var(--accent-text); font-weight: var(--fw-black); }
.pg-nodesheet__stepname--done { color: var(--ink); }
.pg-nodesheet__locked { display: flex; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--radius-12); background: var(--paper-2); }
.pg-nodesheet__lockicon { flex: none; margin-top: 2px; color: var(--ink-2); }
.pg-nodesheet__lockedtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pg-nodesheet__lockedtitle { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); }
.pg-nodesheet__lockedbody { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-nodesheet__error { padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-12); background: var(--fox-soft); color: var(--fox-text); font-size: var(--fs-13); font-weight: var(--fw-heavy); line-height: 1.5; }
.pg-nodesheet__actions { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-1); }
</style>
