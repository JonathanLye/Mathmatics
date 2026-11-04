<script setup lang="ts">
import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ data: Array<{ name: string; value: number }>; height?: number }>();
const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
const observer = new ResizeObserver(() => chart?.resize());

function render(): void {
  if (chart === null) return;
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} 人' },
    series: [
      {
        type: 'funnel',
        left: '8%',
        right: '8%',
        top: 12,
        bottom: 12,
        sort: 'none',
        gap: 2,
        label: { position: 'inside', formatter: '{b} {c}' },
        itemStyle: { borderColor: 'transparent', borderWidth: 0 },
        data: props.data,
      },
    ],
  });
}

onMounted(() => {
  if (el.value === null) return;
  chart = echarts.init(el.value);
  render();
  observer.observe(el.value);
});

watch(() => props.data, render, { deep: true });

onBeforeUnmount(() => {
  observer.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="el" :style="{ height: `${height ?? 260}px`, width: '100%' }" />
</template>
