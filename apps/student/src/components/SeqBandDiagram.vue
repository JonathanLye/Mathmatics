<script setup lang="ts">
/**
 * seq-band 图解（03 §7）：数列点 (n, aₙ) + 水平带 A±ε + 滑块调 ε + 实时 N(ε)。
 *
 * - 只渲染服务端/概念库下发的 VisualSpec，参数化绘制；
 * - 表达式走受限解析器（utils/expr.ts），绝不 eval；
 * - N(ε) 按 03 §7 由点的实际位置算：最小的 N 使 N < n ≤ nMax 的点都在带内。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import { computeSeqBand, describeSeqBand, seqBandParams } from '@/utils/seqBand'
import type { VisualSpec } from '@/types/attempt'

const props = defineProps<{ spec: VisualSpec }>()

const params = computed(() => seqBandParams(props.spec))
const epsMin = computed(() => Number(props.spec?.params?.epsilon?.min ?? 0.02))
const epsMax = computed(() => Number(props.spec?.params?.epsilon?.max ?? 1))
const epsStep = computed(() => Number(props.spec?.params?.epsilon?.step ?? 0.01))
const epsilon = ref<number>(Number(props.spec?.params?.epsilon?.init ?? epsMin.value))

/** 换题/换图解时重置 ε（滑块以服务端下发的 init 为起点）。 */
watch(
  params,
  (next) => {
    if (!next) return
    epsilon.value = Math.min(epsMax.value, Math.max(epsMin.value, next.epsilon))
  },
  { immediate: true },
)

const result = computed(() => {
  const p = params.value
  if (!p) return null
  return computeSeqBand({ ...p, epsilon: epsilon.value })
})

const epsText = computed(() => epsilon.value.toFixed(2))
const nText = computed(() => {
  const n = result.value?.n
  return n === null || n === undefined ? '—' : String(n)
})

// ---- SVG 尺寸与坐标（viewBox 固定，随容器缩放；坐标轴刻度用等宽字体）----
// viewBox 高宽比 ≈ 0.73：390 宽手机上图解区高度 ≈ 屏宽 × 0.6（03 §7 要求 ≥ 0.6）。
const W = 640
const H = 470
const PAD = { left: 60, right: 18, top: 24, bottom: 52 }

const points = computed(() => (result.value?.points ?? []).filter((p) => Number.isFinite(p.value)))

const yRange = computed(() => {
  const limit = params.value?.limit ?? 0
  const values = points.value.map((p) => p.value)
  const lo0 = Math.min(limit - epsilon.value, ...values)
  const hi0 = Math.max(limit + epsilon.value, ...values)
  const pad = Math.max((hi0 - lo0) * 0.08, 0.05)
  return { lo: lo0 - pad, hi: hi0 + pad }
})

function xOf(n: number): number {
  const nMax = params.value?.nMax ?? 60
  return PAD.left + (n / nMax) * (W - PAD.left - PAD.right)
}
function yOf(value: number): number {
  const { lo, hi } = yRange.value
  const ratio = hi === lo ? 0.5 : (value - lo) / (hi - lo)
  return PAD.top + (1 - ratio) * (H - PAD.top - PAD.bottom)
}

const bandTop = computed(() => yOf((params.value?.limit ?? 0) + epsilon.value))
const bandBottom = computed(() => yOf((params.value?.limit ?? 0) - epsilon.value))
const bandHeight = computed(() => Math.max(1, bandBottom.value - bandTop.value))
const limitY = computed(() => yOf(params.value?.limit ?? 0))

const nLineX = computed(() => {
  const n = result.value?.n
  if (n === null || n === undefined || n <= 0) return null
  return xOf(n)
})

const xTicks = computed(() => {
  const nMax = params.value?.nMax ?? 60
  const step = nMax <= 20 ? 1 : nMax <= 60 ? 10 : 50
  const ticks: number[] = []
  for (let n = step; n <= nMax; n += step) ticks.push(n)
  return ticks
})
const yTicks = computed(() => {
  const { lo, hi } = yRange.value
  const ticks: number[] = []
  for (let i = 0; i <= 4; i += 1) ticks.push(lo + ((hi - lo) * i) / 4)
  return ticks
})

function onSliderChange(e: { detail?: { value?: number } } | Event) {
  const detail = (e as { detail?: { value?: number } }).detail
  const value = Number(detail?.value)
  if (Number.isFinite(value)) epsilon.value = value
}
</script>

<template>
  <view v-if="!params || !result" class="pg-seq pg-seq--empty">
    <text class="pg-seq__empty pg-small">图解参数解析失败，这里只显示文字。</text>
  </view>
  <view v-else class="pg-seq" data-testid="seq-band">
    <view class="pg-seq__caption">
      <MathText :text="props.spec.params?.exprLatex || params.expr" block />
      <text class="pg-seq__sub pg-small">{{ props.spec.title || 'ε 带' }}：拖动滑块改变 ε，看从第几项起点都落在带子里。</text>
    </view>

    <view class="pg-seq__chart">
      <svg
        class="pg-seq__svg"
        data-testid="seq-band-svg"
        role="img"
        :aria-label="'seq-band：极限 ' + params.limit + '，ε=' + epsText + '，N=' + nText"
        :viewBox="'0 0 ' + W + ' ' + H"
      >
        <!-- 横轴 / 纵轴 -->
        <line :x1="PAD.left" :y1="H - PAD.bottom" :x2="W - PAD.right" :y2="H - PAD.bottom" class="pg-seq__axis" />
        <line :x1="PAD.left" :y1="PAD.top" :x2="PAD.left" :y2="H - PAD.bottom" class="pg-seq__axis" />
        <text :x="PAD.left - 14" :y="PAD.top + 4" class="pg-seq__tick" text-anchor="middle">aₙ</text>
        <text :x="W - PAD.right" :y="H - PAD.bottom + 20" class="pg-seq__tick" text-anchor="end">n</text>

        <!-- ε 带 -->
        <rect
          :x="PAD.left"
          :y="bandTop"
          :width="W - PAD.left - PAD.right"
          :height="bandHeight"
          class="pg-seq__band"
        />
        <line :x1="PAD.left" :y1="limitY" :x2="W - PAD.right" :y2="limitY" class="pg-seq__limit" />
        <text :x="W - PAD.right" :y="limitY - 6" class="pg-seq__tick" text-anchor="end">A = {{ params.limit }}</text>

        <!-- N：从 N 之后都在带内 -->
        <template v-if="nLineX !== null">
          <line :x1="nLineX" :y1="PAD.top" :x2="nLineX" :y2="H - PAD.bottom" class="pg-seq__nline" />
          <text :x="nLineX + 6" :y="PAD.top + 14" class="pg-seq__ntext">N = {{ nText }}</text>
        </template>

        <!-- 坐标轴刻度 -->
        <text v-for="t in yTicks" :key="'y' + t" :x="PAD.left - 8" :y="yOf(t) + 4" class="pg-seq__tick" text-anchor="end">
          {{ t.toFixed(2) }}
        </text>
        <text v-for="t in xTicks" :key="'x' + t" :x="xOf(t)" :y="H - PAD.bottom + 16" class="pg-seq__tick" text-anchor="middle">
          {{ t }}
        </text>

        <!-- 数列点 -->
        <circle
          v-for="p in points"
          :key="'p' + p.n"
          :cx="xOf(p.n)"
          :cy="yOf(p.value)"
          :r="p.inBand ? 6.2 : 5.4"
          :class="p.inBand ? 'pg-seq__dot pg-seq__dot--in' : 'pg-seq__dot pg-seq__dot--out'"
        />
      </svg>
    </view>

    <view class="pg-seq__sliderrow">
      <text class="pg-seq__sliderlabel pg-small">ε</text>
      <slider
        class="pg-seq__slider"
        data-testid="seq-band-slider"
        :min="epsMin"
        :max="epsMax"
        :step="epsStep"
        :value="epsilon"
        active-color="#2b4fa3"
        background-color="#e2e4e8"
        block-size="20"
        :show-value="false"
        @changing="onSliderChange"
        @change="onSliderChange"
      />
    </view>

    <view class="pg-seq__readout">
      <text class="pg-seq__mono" data-testid="seq-band-eps">ε = {{ epsText }}</text>
      <text class="pg-seq__mono" data-testid="seq-band-n">N = {{ nText }}</text>
    </view>
    <text class="pg-seq__desc pg-small" data-testid="seq-band-desc">{{ describeSeqBand(result) }}</text>
    <text class="pg-seq__footnote pg-small">图中只画到第 {{ params.nMax }} 项。</text>
  </view>
</template>

<style scoped>
.pg-seq {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}
.pg-seq--empty { padding: var(--sp-2); }
.pg-seq__empty { color: var(--ink-2); }
.pg-seq__caption { display: flex; flex-direction: column; gap: 2px; font-family: var(--font-serif); color: var(--ink); }
.pg-seq__sub { color: var(--ink-2); font-family: var(--font-sans); }
.pg-seq__chart {
  width: 100%;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--sheet);
  overflow: hidden;
}
.pg-seq__svg { display: block; width: 100%; height: auto; }
.pg-seq__axis { stroke: var(--rule); stroke-width: 1; }
.pg-seq__band { fill: var(--accent-soft); opacity: 0.9; }
.pg-seq__limit { stroke: var(--ink-2); stroke-width: 1; stroke-dasharray: 4 4; opacity: 0.7; }
.pg-seq__nline { stroke: var(--ok); stroke-width: 1.4; stroke-dasharray: 3 3; }
.pg-seq__dot--in { fill: var(--accent); }
.pg-seq__dot--out { fill: var(--ink-2); opacity: 0.75; }
.pg-seq__tick { fill: var(--ink-2); font-family: var(--font-mono); font-size: 20px; }
.pg-seq__ntext { fill: var(--ok); font-family: var(--font-mono); font-size: 22px; font-weight: 600; }
.pg-seq__sliderrow { display: flex; align-items: center; gap: var(--sp-2); }
.pg-seq__sliderlabel { color: var(--ink-2); flex: 0 0 auto; }
.pg-seq__slider { flex: 1; min-width: 0; }
.pg-seq__readout { display: flex; justify-content: space-between; gap: var(--sp-2); }
.pg-seq__mono { font-family: var(--font-mono); font-size: 13px; color: var(--ink); }
.pg-seq__desc { color: var(--ink-2); }
.pg-seq__footnote { color: var(--ink-2); text-align: right; }
</style>
