<script setup lang="ts">
/**
 * 题面：写之前完整展开；写起来以后收成一行，点一下再看。学生自己点过之后就听学生的。
 * 收起时贴在顶栏下面，随时能点开。
 */
import { ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import type { ProblemView } from '@/types/attempt'

const props = defineProps<{ problem: ProblemView; defaultOpen: boolean; redo?: boolean }>()
const open = ref(props.defaultOpen)
let touched = false

watch(
  () => props.defaultOpen,
  (next) => {
    if (!touched) open.value = next
  },
)
// 换题（重做、下一题）时回到默认。
watch(
  () => props.problem.problemId,
  () => {
    touched = false
    open.value = props.defaultOpen
  },
)

function toggle(): void {
  touched = true
  open.value = !open.value
}
</script>

<template>
  <view class="pg-problem" :class="{ 'pg-problem--open': open }" data-testid="practice-stem">
    <view
      class="pg-problem__peek"
      role="button"
      tabindex="0"
      :aria-expanded="open ? 'true' : 'false'"
      data-testid="practice-stem-toggle"
      @tap="toggle"
      @keydown.enter.prevent="toggle"
    >
      <text v-if="props.redo" class="pg-problem__badge" data-testid="practice-redo-badge">重做</text>
      <view class="pg-problem__title"><MathText :text="props.problem.title" /></view>
      <text class="pg-problem__toggle">{{ open ? '收起' : '看题' }}</text>
      <PgIcon class="pg-problem__chevron" name="chevron" :size="16" color="currentColor" />
    </view>
    <view v-if="open" class="pg-problem__stem">
      <MathText :text="props.problem.stem" serif block />
    </view>
  </view>
</template>

<style scoped>
.pg-problem {
  margin-top: var(--sp-1);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-16);
  background: var(--sheet);
}
.pg-problem:not(.pg-problem--open) {
  position: sticky;
  top: calc(var(--safe-top) + 52px);
  z-index: 15;
}
.pg-problem__peek { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--touch); padding: 0 var(--sp-3); cursor: pointer; }
.pg-problem__title { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-problem__badge { flex: none; padding: 0 var(--sp-2); border-radius: var(--radius-pill); background: var(--sea-soft); color: var(--sea-text); font-size: var(--fs-12); font-weight: var(--fw-black); line-height: 1.8; }
.pg-problem__toggle { flex: none; color: var(--sea-text); font-size: var(--fs-13); font-weight: var(--fw-black); }
.pg-problem__chevron { flex: none; color: var(--sea-text); transform: rotate(90deg); transition: transform var(--dur-base) var(--ease-out); }
.pg-problem--open .pg-problem__chevron { transform: rotate(-90deg); }
.pg-problem__stem { padding: 0 var(--sp-3) var(--sp-3); color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-18); line-height: var(--lh-body); animation: pg-item-in var(--dur-base) var(--ease-out) both; }
</style>
