<script setup lang="ts">
/** 证明本（02 §4.3 完成页延伸；#26 完整版在第二轮）：列出完成的证明与自己的总结。 */
import { useAttempt } from '@/stores/attempt'

const { state } = useAttempt()
const lines = state.value.steps?.lines ?? []
function back() { uni.navigateBack() }
</script>

<template>
  <view class="pg-page pg-book">
    <view class="pg-book__head">
      <button class="pg-book__back pg-tap" @tap="back">‹</button>
      <text class="pg-book__title">我的证明本</text>
    </view>
    <view class="pg-book__card pg-sheet">
      <text class="pg-book__ptitle">{{ state.problem.title }}</text>
      <text class="pg-book__meta pg-small">独立度 {{ state.completion?.independence ?? '-' }} · 透露 {{ state.budget.revealUsed }} / {{ state.budget.revealMax }}</text>
    </view>
    <view class="pg-book__lines pg-sheet">
      <view v-for="l in lines" :key="l.lineId" class="pg-book__line">
        <text class="pg-book__no pg-mono">{{ l.n }}</text>
        <text class="pg-book__stmt">{{ l.statement }}</text>
        <text v-if="l.justification" class="pg-book__just pg-small">依据 {{ l.justification }}</text>
      </view>
    </view>
    <text class="pg-book__hint pg-small">完整证明本（稍后重做、迁移题、总结）在 P1 #47；本轮只做只读展示骨架。</text>
  </view>
</template>

<style scoped>
.pg-book { padding-top: calc(var(--safe-top) + var(--sp-2)); padding-bottom: calc(var(--sp-6) + var(--safe-bottom)); }
.pg-book__head { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.pg-book__back { width: 44px; height: 44px; border: 0; background: transparent; color: var(--ink); font-size: 26px; }
.pg-book__title { font-family: var(--font-serif); font-size: 20px; font-weight: 600; }
.pg-book__card { padding: var(--sp-3); margin-bottom: var(--sp-3); }
.pg-book__ptitle { display: block; font-size: 16px; font-weight: 600; }
.pg-book__meta { display: block; color: var(--ink-2); margin-top: 2px; }
.pg-book__lines { padding: var(--sp-2) var(--sp-3); }
.pg-book__line { display: flex; gap: var(--sp-2); padding: var(--sp-2) 0; border-bottom: 1px solid var(--rule); }
.pg-book__line:last-child { border-bottom: 0; }
.pg-book__no { width: 24px; color: var(--ink-2); font-size: 12px; }
.pg-book__stmt { flex: 1; font-size: 15px; }
.pg-book__just { align-self: flex-start; color: var(--ink-2); }
.pg-book__hint { display: block; margin-top: var(--sp-4); color: var(--ink-2); text-align: center; }
</style>
