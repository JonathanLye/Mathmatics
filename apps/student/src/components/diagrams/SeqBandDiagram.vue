<script setup lang="ts">
/**
 * ε–N 配对关系图（issue #47 P1-2「更多图解模板」之一，对应 03 §7 的 `seq-band`）。
 *
 * 数学含义见 ./seqBand.ts：给定 ε，水平带 A±ε；N(ε) 是最小的 N，使所有 n > N 的项
 * 都落进带内。图上灰点 = 带外（n ≤ N），主题色点 = 带内（n > N），竖线标出 N。
 * 交互：滑块在图的下方（03 §7 / 02 §4.9），拖动只改 ε，N 由带子反推，前端不做判定。
 */
import { computed, ref, watch } from 'vue'

import { bandOf, minN, nTicks, projectN, projectPoint, sampleSeqPoints, SAMPLE_A } from './seqBand'

const props = withDefaults(
  defineProps<{
    /** 误差要求 ε > 0（滑块初始值） */
    epsilon?: number
    /** 极限值 A（默认 seed epsN 的 A = 3） */
    A?: number
    /** 图中最多画到第几项（03 §7 要求标注"图中只画到第 nMax 项"） */
    nMax?: number
    width?: number
    height?: number
  }>(),
  { epsilon: 0.5, A: SAMPLE_A, nMax: 20, width: 320, height: 196 },
)

const emit = defineEmits<{ (event: 'update:epsilon', value: number): void }>()

const localEps = ref(props.epsilon)
watch(
  () => props.epsilon,
  (next) => {
    localEps.value = next
  },
)

const geometry = computed(() => ({
  width: props.width,
  height: props.height,
  padding: { left: 34, right: 14, top: 22, bottom: 40 },
}))
const points = computed(() => sampleSeqPoints(props.nMax))
const band = computed(() => bandOf(props.A, localEps.value))
const result = computed(() => minN(points.value, props.A, localEps.value))
const yRange = computed(() => {
  const values = [props.A, band.value.low, band.value.high, ...points.value.map((point) => point.a)]
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = Math.max(0.05, (max - min) * 0.12)
  return { yMin: min - pad, yMax: max + pad }
})
const toY = (value: number) => {
  const { padding } = geometry.value
  const innerHeight = geometry.value.height - padding.top - padding.bottom
  const yRangeValue = yRange.value.yMax - yRange.value.yMin || 1
  return padding.top + (1 - (value - yRange.value.yMin) / yRangeValue) * innerHeight
}
const projected = computed(() =>
  points.value.map((point) => ({
    ...point,
    ...projectPoint(point, geometry.value, { nMax: props.nMax, ...yRange.value }),
    inside: Math.abs(point.a - props.A) < localEps.value,
  })),
)
const xTicks = computed(() => nTicks(props.nMax, 5))
const thresholdX = computed(() =>
  result.value.N === null ? null : projectN(result.value.N, geometry.value, props.nMax),
)
const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))))
const ariaLabel = computed(
  () =>
    `ε–N 配对关系图：A=${props.A}，ε=${fmt(localEps.value)}，N(ε)=${result.value.N ?? '—'}；` +
    `图中只画到第 ${props.nMax} 项。`,
)
const bandTop = computed(() => toY(band.value.high))
const bandBottom = computed(() => toY(band.value.low))
const axisBottom = computed(() => geometry.value.height - geometry.value.padding.bottom + 6)

function onSlider(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value) || value <= 0) return
  localEps.value = value
  emit('update:epsilon', value)
}
</script>

<template>
  <view class="pg-seq">
    <svg class="pg-seq__svg" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="ariaLabel">
      <!-- 水平带 A±ε（主题色淡底） -->
      <rect
        :x="geometry.padding.left"
        :y="bandTop"
        :width="width - geometry.padding.left - geometry.padding.right"
        :height="Math.max(0, bandBottom - bandTop)"
        class="pg-seq__band"
      />
      <!-- 极限值 A 与带边 -->
      <line
        :x1="geometry.padding.left"
        :x2="width - geometry.padding.right"
        :y1="toY(A)"
        :y2="toY(A)"
        class="pg-seq__center"
      />
      <text :x="width - geometry.padding.right" :y="toY(A) - 4" class="pg-seq__label" text-anchor="end">A = {{ fmt(A) }}</text>

      <!-- 坐标轴 -->
      <line
        :x1="geometry.padding.left"
        :x2="width - geometry.padding.right"
        :y1="axisBottom"
        :y2="axisBottom"
        class="pg-seq__axis"
      />
      <line
        :x1="geometry.padding.left"
        :x2="geometry.padding.left"
        :y1="geometry.padding.top"
        :y2="axisBottom"
        class="pg-seq__axis"
      />
      <g v-for="n in xTicks" :key="n">
        <line :x1="projectN(n, geometry, nMax)" :x2="projectN(n, geometry, nMax)" :y1="axisBottom - 3" :y2="axisBottom + 3" class="pg-seq__axis" />
        <text :x="projectN(n, geometry, nMax)" :y="axisBottom + 13" class="pg-seq__tick" text-anchor="middle">{{ n }}</text>
      </g>

      <!-- 数据点：带外灰色、带内主题色 -->
      <circle
        v-for="point in projected"
        :key="point.n"
        :cx="point.x"
        :cy="point.y"
        r="3"
        :class="point.inside ? 'pg-seq__dot pg-seq__dot--inside' : 'pg-seq__dot pg-seq__dot--outside'"
      />

      <!-- N(ε)：竖线 + 标注 -->
      <g v-if="thresholdX !== null">
        <line
          :x1="thresholdX"
          :x2="thresholdX"
          :y1="geometry.padding.top - 4"
          :y2="axisBottom"
          class="pg-seq__threshold"
        />
        <text :x="thresholdX + 4" :y="geometry.padding.top + 8" class="pg-seq__label">N(ε) = {{ result.N }}</text>
      </g>

      <!-- 带外点的最大项号（N 的来源） -->
      <text :x="geometry.padding.left" :y="geometry.padding.top - 6" class="pg-seq__label pg-seq__label--small" text-anchor="start">
        水平带 A±ε：{{ fmt(band.low) }} ~ {{ fmt(band.high) }}
      </text>
    </svg>

    <!-- 滑块在图的下方（02 §4.9），旁边实时显示数值（等宽字体） -->
    <view class="pg-seq__controls">
      <input
        class="pg-seq__slider"
        type="range"
        min="0.1"
        max="2"
        step="0.05"
        :value="localEps"
        aria-label="拖动调整 ε"
        @input="onSlider"
      />
      <text class="pg-seq__mono pg-small">ε = {{ fmt(localEps) }} · N(ε) = {{ result.N ?? '—' }}</text>
    </view>
    <text class="pg-seq__note pg-small">图中只画到第 {{ nMax }} 项；N(ε) 是最小的 N，使所有 n &gt; N 的项都满足 |a_n − A| &lt; ε。</text>
  </view>
</template>

<style scoped>
.pg-seq { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-seq__svg { width: 100%; height: auto; display: block; }
.pg-seq__band { fill: var(--accent-soft); }
.pg-seq__axis { stroke: var(--rule); stroke-width: 1; }
.pg-seq__center { stroke: var(--ink-2); stroke-width: 1; stroke-dasharray: 4 3; }
.pg-seq__threshold { stroke: var(--margin); stroke-width: 1; stroke-dasharray: 2 3; }
.pg-seq__tick { fill: var(--ink-2); font-family: var(--font-mono); font-size: 9px; }
.pg-seq__label { fill: var(--ink); font-family: var(--font-mono); font-size: 10px; }
.pg-seq__label--small { fill: var(--ink-2); font-size: 9px; }
.pg-seq__dot--inside { fill: var(--accent); }
.pg-seq__dot--outside { fill: var(--ink-2); }
.pg-seq__controls { display: flex; align-items: center; gap: var(--sp-2); }
.pg-seq__slider { flex: 1; min-height: 28px; accent-color: var(--accent); }
.pg-seq__mono { font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
.pg-seq__note { color: var(--ink-2); }
</style>
