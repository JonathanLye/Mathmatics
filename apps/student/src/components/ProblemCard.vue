<script setup lang="ts">
/** 题面卡：默认展开；向上滚动后收成一行「看题」胶囊（02 §3.1）。 */
import { ref } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { ProblemView } from '@/types/attempt'

const props = defineProps<{ problem: ProblemView }>()
const collapsed = ref(false)
</script>

<template>
  <view class="pg-problem pg-sheet" :class="{ 'pg-problem--collapsed': collapsed }">
    <view class="pg-problem__head">
      <text class="pg-problem__title">{{ props.problem.title }}</text>
      <text class="pg-problem__meta pg-small">{{ props.problem.chapter }} · 关键步骤 {{ props.problem.keyCount }}</text>
      <button class="pg-problem__toggle pg-tap pg-small" @tap="collapsed = !collapsed">{{ collapsed ? '看题' : '收起' }}</button>
    </view>
    <view v-if="!collapsed" class="pg-problem__stem">
      <MathText :text="props.problem.stem" serif block />
    </view>
  </view>
</template>

<style scoped>
.pg-problem { margin: var(--sp-3) 0; padding: var(--sp-3) var(--sp-4); }
.pg-problem__head { display: flex; align-items: center; gap: var(--sp-1) var(--sp-2); flex-wrap: wrap; }
.pg-problem__title { flex: 1; min-width: 0; font-size: 17px; font-weight: 900; color: var(--ink); }
.pg-problem__meta { order: 3; flex-basis: 100%; color: var(--ink-2); font-weight: 700; }
.pg-problem__toggle {
  min-height: 32px;
  padding: 0 var(--sp-3);
  border: 2px solid var(--rule);
  border-radius: 10px;
  background: var(--sheet);
  color: var(--margin-text);
  font-size: 12px;
  font-weight: 900;
}
.pg-problem__toggle::after { display: none; }
.pg-problem__stem { margin-top: var(--sp-2); font-family: var(--font-serif); font-size: var(--fs-stem); line-height: 1.6; color: var(--ink); }
</style>
