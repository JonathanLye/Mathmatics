<script setup lang="ts">
/** 题面卡：默认展开；向上滚动后收成一行「看题」胶囊（02 §3.1）。 */
import { ref } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import type { ProblemView } from '@/types/attempt'

const props = defineProps<{ problem: ProblemView }>()
const collapsed = ref(false)
</script>

<template>
  <view class="pg-problem pg-sheet" :class="{ 'pg-problem--collapsed': collapsed }">
    <view class="pg-problem__head">
      <view class="pg-problem__title"><MathText :text="props.problem.title" /></view>
      <text class="pg-problem__meta">{{ props.problem.chapter }} · 关键步骤 {{ props.problem.keyCount }}</text>
      <PgButton class="pg-problem__toggle" variant="ghost" size="sm" @tap="collapsed = !collapsed">{{ collapsed ? '看题' : '收起' }}</PgButton>
    </view>
    <view v-if="!collapsed" class="pg-problem__stem">
      <MathText :text="props.problem.stem" serif block />
    </view>
  </view>
</template>

<style scoped>
.pg-problem { margin: var(--sp-3) 0; padding: var(--sp-3) var(--sp-4); }
.pg-problem__head { display: flex; align-items: center; gap: 0 var(--sp-2); flex-wrap: wrap; }
.pg-problem__title { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-18); font-weight: var(--fw-black); }
.pg-problem__meta { order: 3; flex-basis: 100%; color: var(--ink-2); font-size: var(--fs-13); }
.pg-problem__toggle.pg-button { margin-right: calc(-1 * var(--sp-2)); color: var(--sea-text); }
.pg-problem__stem { margin-top: var(--sp-2); color: var(--ink); font-family: var(--font-serif); font-size: var(--fs-18); line-height: var(--lh-body); }
</style>
