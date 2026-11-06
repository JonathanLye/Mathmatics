<script setup lang="ts">
/** 额度条：提示额度 x / 2 · 自己写出 y / n；点开解释（02 §3.1）。 */
import { ref } from 'vue'
import type { BudgetView } from '@/types/attempt'
import PgIcon from '@/components/ui/PgIcon.vue'
import { COPY } from '@/copy'

const props = defineProps<{ budget: BudgetView }>()
const open = ref(false)
const units = (max: number): number[] => Array.from({ length: Math.max(0, Math.ceil(max)) }, (_, i) => i)
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
</script>

<template>
  <view class="pg-budget">
    <view class="pg-budget__bar" role="button" tabindex="0" :aria-expanded="open ? 'true' : 'false'" @tap="open = !open" @keydown.enter.prevent="open = !open">
      <view class="pg-budget__bulbs" aria-hidden="true">
        <PgIcon v-for="i in units(props.budget.revealMax)" :key="i" name="bulb" :size="20" :tone="i < props.budget.revealUsed ? 'off' : 'on'" />
      </view>
      <text class="pg-budget__item">{{ COPY.hintBudget }} {{ fmt(props.budget.revealUsed) }} / {{ fmt(props.budget.revealMax) }}</text>
      <text class="pg-budget__item pg-budget__own">自己写出 {{ props.budget.keysOwn }} / {{ props.budget.keysTotal }}</text>
      <text class="pg-budget__chevron">{{ open ? '收起' : '解释' }}</text>
    </view>
    <view v-if="open" class="pg-budget__pop">
      <text>「提示额度」是你领取提示时用掉的量；「自己写出」是靠自己写出的关键步骤个数（看过示范的不算）。</text>
    </view>
  </view>
</template>

<style scoped>
.pg-budget { padding: var(--sp-1) var(--sp-4) var(--sp-2); }
.pg-budget__bar { display: flex; align-items: center; flex-wrap: wrap; gap: 2px var(--sp-2); min-height: var(--touch); color: var(--ink-2); cursor: pointer; }
.pg-budget__bulbs { display: flex; gap: 2px; }
.pg-budget__item { color: var(--bee-text); font-size: var(--fs-13); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-budget__own { color: var(--accent-text); }
.pg-budget__chevron { margin-left: auto; color: var(--ink-2); font-size: var(--fs-13); font-weight: var(--fw-heavy); }
.pg-budget__pop { margin-top: var(--sp-1); padding: var(--sp-2) var(--sp-3); background: var(--bee-soft); border: var(--bw) solid var(--bee); border-radius: var(--radius-16); color: var(--ink); font-size: var(--fs-13); line-height: var(--lh-body); }
</style>
