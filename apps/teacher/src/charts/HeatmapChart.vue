<script setup lang="ts">
import * as echarts from 'echarts';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  labels: string[];
  own: number[];
  viaHint: number[];
  height?: number;
}>();
const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;
const observer = new ResizeObserver(() => chart?.resize());

function render(): void {
  if (chart === null) return;
  const rows = ['自己写出', '经提示写出'];
  const data = props.labels.flatMap((_, index) => [
    [index, 0, props.own[index] ?? 0],
    [index, 1, props.viaHint[index] ?? 0],
  ]);
  const max = Math.max(1, ...data.map((item) => Number(item[2] ?? 0)));
  chart.setOption({
    tooltip: { position: 'top' },
    grid: { left: 80, right: 20, top: 16, bottom: 80 },
    xAxis: { type: 'category', data: props.labels, axisLabel: { rotate: 30, interval: 0 } },
    yAxis: { type: 'category', data: rows },
    visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#e8f1ff', '#006eff'] } },
    series: [{ type: 'heatmap', data, label: { show: true }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' } } }],
  });
}

onMounted(() => {
  if (el.value === null) return;
  chart = echarts.init(el.value);
  render();
  observer.observe(el.value);
});

watch(() => [props.labels, props.own, props.viaHint], render, { deep: true });

onBeforeUnmount(() => {
  observer.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="el" :style="{ height: `${height ?? 300}px`, width: '100%' }" />
</template>
