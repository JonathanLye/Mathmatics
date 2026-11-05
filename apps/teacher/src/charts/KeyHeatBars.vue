<script setup lang="ts">
import { computed } from 'vue';

import type { KeyHeatRow } from '../utils/metrics.ts';

// 关键步骤卡点：每个关键步骤一条堆叠条（绿=自己写出，黄=经提示写出）。条长只比较同图内的相对多少。
const props = defineProps<{ rows: KeyHeatRow[] }>();
const max = computed(() => Math.max(1, ...props.rows.map((r) => r.total)));
</script>

<template>
  <div class="kh">
    <div class="kh__legend"><i class="kh__dot kh__dot--own" />自己写出<i class="kh__dot kh__dot--via" />经提示写出</div>
    <div v-for="r in rows" :key="r.label" class="kh__row" :data-testid="`keyheat-${r.label}`">
      <span class="kh__label" :title="r.label">{{ r.label }}</span>
      <span class="kh__track">
        <span class="kh__seg kh__seg--own" :style="{ width: `${(r.own / max) * 100}%` }" />
        <span class="kh__seg kh__seg--via" :style="{ width: `${(r.viaHint / max) * 100}%` }" />
      </span>
      <span class="kh__val">{{ r.own }}<span class="kh__sep">/</span>{{ r.viaHint }}</span>
    </div>
  </div>
</template>

<style scoped>
.kh { display: grid; gap: 10px; padding: 6px 0 2px; }
.kh__legend { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--pg-text-secondary); }
.kh__dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-left: 8px; }
.kh__dot:first-child { margin-left: 0; }
.kh__dot--own, .kh__seg--own { background: #58cc02; }
.kh__dot--via, .kh__seg--via { background: #ffc800; }
.kh__row { display: grid; grid-template-columns: minmax(48px, 120px) 1fr 52px; align-items: center; gap: 10px; }
.kh__label { font-weight: 800; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kh__track { display: flex; height: 20px; border-radius: 10px; background: rgba(127, 127, 127, 0.16); overflow: hidden; }
.kh__seg { display: block; height: 100%; box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.14); }
.kh__val { text-align: right; font-weight: 900; font-size: 14px; font-variant-numeric: tabular-nums; }
.kh__sep { color: var(--pg-text-secondary); margin: 0 1px; }
</style>
