<script setup lang="ts">
/** 预算条：透露 x / 2 · 自己写出 y / n；点开解释（02 §3.1）。 */
import { ref } from 'vue'
import type { BudgetView } from '@/types/attempt'

const props = defineProps<{ budget: BudgetView }>()
const open = ref(false)
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
</script>

<template>
  <view class="pg-budget">
    <view class="pg-budget__bar" role="button" @tap="open = !open">
      <text class="pg-budget__item pg-mono">
        透露 {{ fmt(props.budget.revealUsed) }} / {{ fmt(props.budget.revealMax) }}
      </text>
      <text class="pg-budget__sep">·</text>
      <text class="pg-budget__item pg-mono pg-budget__own">
        自己写出 {{ props.budget.keysOwn }} / {{ props.budget.keysTotal }}
      </text>
      <text class="pg-budget__chevron pg-small">{{ open ? '收起' : '解释' }}</text>
    </view>
    <view v-if="open" class="pg-budget__pop pg-small">
      <text>「透露」是你领取高阶提示时累计的代价；「自己写出」是独立写出关键步骤的个数（H4 示范不计数）。</text>
    </view>
  </view>
</template>

<style scoped>
.pg-budget { padding: var(--sp-1) var(--sp-4) var(--sp-2); }
.pg-budget__bar {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: 36px;
  color: var(--ink-2);
}
.pg-budget__item { font-size: 12px; }
.pg-budget__own { color: var(--ok); }
.pg-budget__sep { color: var(--rule); }
.pg-budget__chevron { margin-left: auto; color: var(--ink-2); text-decoration: underline; }
.pg-budget__pop {
  margin-top: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  background: var(--sheet);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  color: var(--ink-2);
  line-height: 1.6;
}
</style>
