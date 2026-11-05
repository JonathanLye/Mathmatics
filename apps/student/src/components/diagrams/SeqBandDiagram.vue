<script setup lang="ts">
/**
 * ε–N 配对关系图（03 §7 的 seq-band；#47 P1 图解模板 + #26 微课接线收敛版）。
 *
 * - 纯计算/坐标映射在 ./seqBand.ts；本组件只渲染，不做数学判定。
 * - points 可由调用方传入（微课用概念库 expr 算出的序列点，避免出现本题的数列）；
 *   缺省用 seed epsN 的示例序列（单独演示/证明本回顾用）。
 * - 滑块用 uni <slider>（H5/小程序通用），放在图的下面（02 §4.9），旁边实时显示 ε / N。
 *
 * 注：uni-app H5 会把模板里的 <text> 当内置组件编译进 SVG（文字不渲染），
 * 因此 SVG 只画图形，文字用 HTML 叠层（.pg-svg__label）渲染。
 */
import { computed, ref, watch } from 'vue'

import { bandOf, minN, nTicks, projectN, projectPoint, sampleSeqPoints, SAMPLE_A, type SeqPoint } from './seqBand'
import { useThemeToken } from '@/composables/useThemeToken'
import { FALLBACK_TOKEN } from '@/utils/themeTokens'

const sliderAccent = useThemeToken('--accent', FALLBACK_TOKEN.accent)
const sliderRule = useThemeToken('--rule', FALLBACK_TOKEN.rule)

const props = withDefaults(
  defineProps<{
    /** 自定义序列点（微课用）；缺省用 seed epsN 的示例序列。 */
    points?: SeqPoint[]
    /** 误差要求 ε > 0（滑块初始值） */
    epsilon?: number
    /** 极限值 A（默认 seed epsN 的 A = 3） */
    A?: number
    /** 图中最多画到第几项（03 §7 要求标注"图中只画到第 nMax 项"） */
    nMax?: number
    width?: number
    height?: number
    /** 滑块的 ε 范围（来自 VisualSpec.params.epsilon）。 */
    min?: number
    max?: number
    step?: number
  }>(),
  {
    points: () => [],
    epsilon: 0.5,
    A: SAMPLE_A,
    nMax: 20,
    width: 320,
    height: 236,
    min: 0.1,
    max: 2,
    step: 0.05,
  },
)

const emit = defineEmits<{ (event: 'update:epsilon', value: number): void }>()

const localEps = ref(props.epsilon)
watch(
  () => props.epsilon,
  (next) => {
    localEps.value = next
  },
)
watch(
  () => [props.min, props.max],
  () => {
    localEps.value = Math.min(props.max, Math.max(props.min, localEps.value))
  },
)

const geometry = computed(() => ({
  width: props.width,
  height: props.height,
  padding: { left: 34, right: 14, top: 34, bottom: 44 },
}))
const dataPoints = computed(() => (props.points.length > 0 ? props.points : sampleSeqPoints(props.nMax)))
const band = computed(() => bandOf(props.A, localEps.value))
const result = computed(() => minN(dataPoints.value, props.A, localEps.value))
const yRange = computed(() => {
  const values = [props.A, band.value.low, band.value.high, ...dataPoints.value.map((point) => point.a)]
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
  dataPoints.value.map((point) => ({
    ...point,
    ...projectPoint(point, geometry.value, { nMax: props.nMax, ...yRange.value }),
    inside: Math.abs(point.a - props.A) < localEps.value,
  })),
)
const xTicks = computed(() => nTicks(props.nMax, 5))
const thresholdX = computed(() => (result.value.N === null ? null : projectN(result.value.N, geometry.value, props.nMax)))
const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))))
const epsText = computed(() => Number(localEps.value).toFixed(2))
const nText = computed(() => (result.value.N === null ? '—' : String(result.value.N)))
const ariaLabel = computed(
  () =>
    'ε–N 配对关系图：A=' + fmt(props.A) + '，ε=' + epsText.value + '，N(ε)=' + nText.value + '；图中只画到第 ' + props.nMax + ' 项。',
)
const bandTop = computed(() => toY(band.value.high))
const bandBottom = computed(() => toY(band.value.low))
const axisBottom = computed(() => geometry.value.height - geometry.value.padding.bottom + 6)

interface OverlayLabel {
  id: string
  x: number
  y: number
  text: string
  anchor: 'start' | 'middle' | 'end'
  kind: 'muted' | 'ink' | 'accent' | 'margin' | 'tick'
}

const labels = computed<OverlayLabel[]>(() => {
  const list: OverlayLabel[] = [
    {
      id: 'band',
      x: geometry.value.padding.left,
      y: geometry.value.padding.top - 10,
      text: '水平带 A±ε：' + fmt(band.value.low) + ' ~ ' + fmt(band.value.high),
      anchor: 'start',
      kind: 'muted',
    },
    { id: 'a', x: props.width - geometry.value.padding.right, y: toY(props.A) - 8, text: 'A = ' + fmt(props.A), anchor: 'end', kind: 'ink' },
  ]
  if (thresholdX.value !== null) {
    list.push({ id: 'n', x: thresholdX.value + 4, y: geometry.value.padding.top + 12, text: 'N = ' + nText.value, anchor: 'start', kind: 'margin' })
  }
  xTicks.value.forEach((n) => {
    list.push({ id: 'tick-' + n, x: projectN(n, geometry.value, props.nMax), y: axisBottom.value + 14, text: String(n), anchor: 'middle', kind: 'tick' })
  })
  return list
})

function labelStyle(label: OverlayLabel): string {
  const anchor = label.anchor === 'start' ? 'translate(0, -50%)' : label.anchor === 'end' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)'
  return 'left:' + ((label.x / props.width) * 100).toFixed(2) + '%;top:' + ((label.y / props.height) * 100).toFixed(2) + '%;transform:' + anchor + ';'
}

function onSlider(event: { detail?: { value?: number } } | Event): void {
  const value = Number((event as { detail?: { value?: number } }).detail?.value)
  if (!Number.isFinite(value) || value <= 0) return
  localEps.value = value
  emit('update:epsilon', value)
}
</script>

<template>
  <view class="pg-seq" data-testid="seq-band">
    <view class="pg-svg">
      <svg class="pg-svg__canvas" data-testid="seq-band-svg" :viewBox="'0 0 ' + width + ' ' + height" role="img" :aria-label="ariaLabel">
        <rect
          :x="geometry.padding.left"
          :y="bandTop"
          :width="width - geometry.padding.left - geometry.padding.right"
          :height="Math.max(0, bandBottom - bandTop)"
          class="pg-seq__band"
        />
        <line :x1="geometry.padding.left" :x2="width - geometry.padding.right" :y1="toY(A)" :y2="toY(A)" class="pg-seq__center" />
        <line :x1="geometry.padding.left" :x2="width - geometry.padding.right" :y1="axisBottom" :y2="axisBottom" class="pg-seq__axis" />
        <line :x1="geometry.padding.left" :x2="geometry.padding.left" :y1="geometry.padding.top" :y2="axisBottom" class="pg-seq__axis" />
        <line
          v-for="n in xTicks"
          :key="'tk' + n"
          :x1="projectN(n, geometry, nMax)"
          :x2="projectN(n, geometry, nMax)"
          :y1="axisBottom - 3"
          :y2="axisBottom + 3"
          class="pg-seq__axis"
        />
        <circle
          v-for="point in projected"
          :key="point.n"
          :cx="point.x"
          :cy="point.y"
          r="3.4"
          :class="point.inside ? 'pg-seq__dot pg-seq__dot--inside' : 'pg-seq__dot pg-seq__dot--outside'"
        />
        <line
          v-if="thresholdX !== null"
          :x1="thresholdX"
          :x2="thresholdX"
          :y1="geometry.padding.top - 4"
          :y2="axisBottom"
          class="pg-seq__threshold"
        />
      </svg>
      <view class="pg-svg__labels" aria-hidden="true">
        <text
          v-for="label in labels"
          :key="label.id"
          class="pg-svg__label"
          :class="'pg-svg__label--' + label.kind"
          :style="labelStyle(label)"
        >{{ label.text }}</text>
      </view>
    </view>

    <slider
      class="pg-seq__slider"
      data-testid="seq-band-slider"
      :min="min"
      :max="max"
      :step="step"
      :value="localEps"
      :show-value="false"
      :active-color="sliderAccent"
      :background-color="sliderRule"
      block-size="20"
      @changing="onSlider"
      @change="onSlider"
    />
    <view class="pg-seq__readout">
      <text class="pg-seq__mono pg-small" data-testid="seq-band-eps">ε = {{ epsText }}</text>
      <text class="pg-seq__mono pg-small" data-testid="seq-band-n">N = {{ nText }}</text>
    </view>
    <text class="pg-seq__note pg-small" data-testid="seq-band-desc">
      图中只画到第 {{ nMax }} 项；N(ε) 是最小的 N，使所有 n &gt; N 的项都满足 |a_n − A| &lt; ε。
    </text>
  </view>
</template>

<style scoped>
.pg-seq { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-svg { position: relative; width: 100%; }
.pg-svg__canvas { width: 100%; height: auto; display: block; }
.pg-svg__labels { position: absolute; inset: 0; pointer-events: none; }
.pg-svg__label {
  position: absolute;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  color: var(--ink);
}
.pg-svg__label--muted { color: var(--ink-2); font-size: 9px; }
.pg-svg__label--ink { color: var(--ink); }
.pg-svg__label--margin { color: var(--margin); }
.pg-svg__label--tick { color: var(--ink-2); font-size: 9px; }
.pg-seq__band { fill: var(--accent-soft); }
.pg-seq__axis { stroke: var(--rule); stroke-width: 1; }
.pg-seq__center { stroke: var(--ink-2); stroke-width: 1; stroke-dasharray: 4 3; }
.pg-seq__threshold { stroke: var(--margin); stroke-width: 1; stroke-dasharray: 2 3; }
.pg-seq__dot--inside { fill: var(--accent); }
.pg-seq__dot--outside { fill: var(--ink-2); }
.pg-seq__slider { width: 100%; }
.pg-seq__readout { display: flex; justify-content: space-between; gap: var(--sp-2); }
.pg-seq__mono { font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
.pg-seq__note { color: var(--ink-2); }
</style>
