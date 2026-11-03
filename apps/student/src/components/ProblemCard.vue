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
.pg-problem {
  margin: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
}
.pg-problem__head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.pg-problem__title {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}
.pg-problem__meta { color: var(--ink-2); }
.pg-problem__toggle {
  margin-left: auto;
  min-height: 32px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font-size: 12px;
}
.pg-problem__stem {
  margin-top: var(--sp-2);
  font-family: var(--font-serif);
  font-size: 17px;
  line-height: 1.6;
  color: var(--ink);
}
</style>
