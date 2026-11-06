<script setup lang="ts">
import { computed } from 'vue';

// 层漏斗：六层当前人数。纯 HTML/CSS 的细条，不依赖图表库。
const props = defineProps<{ data: Array<{ name: string; value: number }> }>();
const max = computed(() => Math.max(1, ...props.data.map((d) => d.value)));
const total = computed(() => props.data.reduce((sum, d) => sum + d.value, 0));
</script>

<template>
  <div class="ls" role="img" :aria-label="`当前在各层的人数，共 ${total} 人`">
    <div v-for="d in data" :key="d.name" class="ls__row" :data-testid="`layer-bar-${d.name}`">
      <span class="ls__name">{{ d.name }}</span>
      <span class="ls__track">
        <span class="ls__bar" :style="{ width: d.value > 0 ? `${Math.max(8, (d.value / max) * 100)}%` : '0%' }" />
      </span>
      <span class="ls__val">{{ d.value }}</span>
    </div>
  </div>
</template>

<style scoped>
.ls { display: grid; gap: 10px; padding: 6px 0 2px; }
.ls__row { display: grid; grid-template-columns: 64px 1fr 32px; align-items: center; gap: 10px; }
.ls__name { font-weight: 700; font-size: 13px; color: var(--pg-text-secondary); }
.ls__track { height: 14px; border-radius: 4px; background: var(--pg-rule); overflow: hidden; }
.ls__bar { display: block; height: 100%; border-radius: 4px; background: var(--pg-accent); transition: width 0.35s ease-out; }
.ls__val { text-align: right; font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .ls__bar { transition: none; } }
</style>
