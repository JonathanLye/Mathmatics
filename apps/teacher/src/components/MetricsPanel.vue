<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, ApiError } from '../api/client.ts';
import type { MetricsView } from '../api/types.ts';
import KeyHeatBars from '../charts/KeyHeatBars.vue';
import LayerSteps from '../charts/LayerSteps.vue';
import {
  METRIC_EXPLAIN,
  formatCount,
  formatRate,
  formatSeconds,
  independenceBand,
  keyHeatRows,
  layerFunnelData,
} from '../utils/metrics.ts';

type KeyHeatItem = { key?: string; label?: string; own?: number; viaHint?: number };
type Metrics = MetricsView & { keyHeat?: KeyHeatItem[] };

const props = defineProps<{ classId: string; assignmentId?: string }>();

const metrics = ref<Metrics | null>(null);
const loading = ref(false);
const error = ref('');

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const query = props.assignmentId === undefined ? '' : `?assignmentId=${props.assignmentId}`;
    metrics.value = await api.get<Metrics>(`/api/v1/teacher/classes/${props.classId}/metrics${query}`);
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '加载指标失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const cards = computed(() => {
  const m = metrics.value;
  return [
    { key: 'completionRate', label: '完成率', value: formatRate(m?.completionRate ?? null) },
    {
      key: 'independenceMedian',
      label: '独立度中位数',
      value:
        m?.independenceMedian === null || m?.independenceMedian === undefined
          ? '—'
          : `${formatRate(m.independenceMedian)}（${independenceBand(m.independenceMedian)}）`,
    },
    { key: 'firstHelpLatency', label: '首次求助前', value: formatSeconds(m?.firstHelpLatencyMedianSec ?? null) },
    { key: 'postHintDwell', label: '提示后停留', value: formatSeconds(m?.postHintDwellMedianSec ?? null) },
    { key: 'autonomousCoverage', label: '自主覆盖率', value: formatRate(m?.autonomousCoverage ?? null) },
    { key: 'rapidHintEvents', label: '连点次数', value: formatCount(m?.rapidHintEvents ?? null) },
  ];
});

const sample = computed(() => metrics.value?.n ?? 0);
const lowSample = computed(() => metrics.value !== null && sample.value < 10);

const funnel = computed(() => layerFunnelData(metrics.value?.layerFunnel as Record<string, number> | undefined));

const keyRows = computed(() => keyHeatRows(metrics.value?.keyHeat));

defineExpose({ load });
</script>

<template>
  <div>
    <div class="page-head" style="margin-top: 12px">
      <h3 style="margin: 0">班级指标</h3>
      <t-button size="small" :loading="loading" @click="load">刷新</t-button>
    </div>
    <t-alert v-if="error" theme="error" :message="error" style="margin: 8px 0" />
    <t-alert
      v-if="lowSample"
      theme="info"
      :message="`目前只有 ${sample} 份作答，不足 10 份：只显示人数和计数，不显示比例和中位数，以免被个别学生带偏。`"
      style="margin: 8px 0"
    />

    <div class="stat-cards">
      <div v-for="card in cards" :key="card.key" class="stat-card">
        <div class="value">{{ card.value }}</div>
        <div class="label">
          {{ card.label }}
          <t-tooltip :content="METRIC_EXPLAIN[card.key] ?? ''">
            <span class="info-icon">ⓘ</span>
          </t-tooltip>
        </div>
      </div>
      <div class="stat-card">
        <div class="value">{{ formatCount(metrics?.integrity?.flagged ?? null) }}</div>
        <div class="label">
          诚信提醒
          <t-tooltip :content="METRIC_EXPLAIN.integrity">
            <span class="info-icon">ⓘ</span>
          </t-tooltip>
        </div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <div class="chart-title">
          各层现在有多少人
          <t-tooltip :content="METRIC_EXPLAIN.layerFunnel"><span class="info-icon">ⓘ</span></t-tooltip>
        </div>
        <LayerSteps v-if="sample > 0" :data="funnel" />
        <div v-else class="empty">暂无数据</div>
      </div>
      <div class="chart-card">
        <div class="chart-title">
          关键步骤卡点
          <t-tooltip :content="METRIC_EXPLAIN.keyHeat"><span class="info-icon">ⓘ</span></t-tooltip>
        </div>
        <KeyHeatBars v-if="keyRows.length > 0" :rows="keyRows" />
        <div v-else class="empty">暂无关键步骤匹配数据</div>
      </div>
    </div>

    <div class="page-sub">指标由服务端统一计算，这里只展示，不会在浏览器里重新计算。</div>
  </div>
</template>

<style scoped>
.info-icon {
  cursor: help;
  color: var(--pg-ink-3);
  margin-left: 2px;
}
</style>
