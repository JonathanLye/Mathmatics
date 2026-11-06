<script setup lang="ts">
/** 计数条：关键步骤 y / n（写证明之后才有意义）+ 提示额度 x / m；点一下看解释。 */
import { ref } from 'vue'
import type { BudgetView } from '@/types/attempt'
import PgIcon from '@/components/ui/PgIcon.vue'
import { COPY } from '@/copy'

const props = withDefaults(defineProps<{ budget: BudgetView; showKeys?: boolean }>(), { showKeys: true })
const open = ref(false)
const units = (max: number): number[] => Array.from({ length: Math.max(0, Math.ceil(max)) }, (_, i) => i)
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
</script>

<template>
  <view class="pg-budget" data-testid="practice-keycounter">
    <view class="pg-budget__bar" role="button" tabindex="0" :aria-expanded="open ? 'true' : 'false'" @tap="open = !open" @keydown.enter.prevent="open = !open">
      <text v-if="props.showKeys" class="pg-budget__keys" data-testid="practice-keys">关键步骤 {{ props.budget.keysOwn }}/{{ props.budget.keysTotal }}</text>
      <view class="pg-budget__hint">
        <view class="pg-budget__bulbs" aria-hidden="true">
          <PgIcon v-for="i in units(props.budget.revealMax)" :key="i" name="bulb" :size="18" :tone="i < props.budget.revealUsed ? 'off' : 'on'" />
        </view>
        <text class="pg-budget__item">{{ COPY.hintBudget }} {{ fmt(props.budget.revealUsed) }} / {{ fmt(props.budget.revealMax) }}</text>
      </view>
    </view>
    <view v-if="open" class="pg-budget__pop">
      <text>「关键步骤」是这道题要写到的几个关键点，写到一个就多一个；「提示额度」是领取提示时用掉的量，这一步会算作看过提示。</text>
    </view>
  </view>
</template>

<style scoped>
.pg-budget { padding: var(--sp-1) 0 0; }
.pg-budget__bar { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); min-height: var(--touch); cursor: pointer; }
.pg-budget__keys { color: var(--accent-text); font-size: var(--fs-15); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-budget__hint { display: flex; align-items: center; gap: var(--sp-1); margin-left: auto; min-width: 0; }
.pg-budget__bulbs { display: flex; gap: 1px; }
.pg-budget__item { color: var(--bee-text); font-size: var(--fs-13); font-weight: var(--fw-black); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-budget__pop { margin-top: var(--sp-1); padding: var(--sp-2) var(--sp-3); background: var(--bee-soft); border: var(--bw) solid var(--bee); border-radius: var(--radius-16); color: var(--ink); font-size: var(--fs-13); line-height: var(--lh-body); }
</style>
