<script setup lang="ts">
/**
 * 单调性相邻项对比（03 §7 的 monotone-steps）：uₙ 与 uₙ₊₁ 的差值符号。
 *
 * - 纯计算在 ./monotoneSteps.ts；表达式走 ./expr.ts 受限解析，绝不 eval；
 * - 只展示差值/单调方向，不做收敛判定；交互：拖动 n 看当前相邻两项；
 * - SVG 只画图形，文字用 HTML 叠层（uni-app H5 的 SVG 内 <text> 不渲染）。
 */
import { computed, ref, watch } from 'vue'
import type { VisualSpec } from '@/types/attempt'
import { computeMonotoneSteps, projectN, type MonotoneStepsView } from './monotoneSteps'

const props = withDefaults(defineProps<{ spec?: VisualSpec | null; width?: number; height?: number }>(), {
  spec: null,
  width: 320,
  height: 180,
})

const expr = computed(() => {
  const value = props.spec?.params?.expr
  return typeof value === 'string' ? value : ''
})
const rawNMax = computed(() => {
  const value = props.spec?.params?.nMax
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 20
})

const base = computed(() => computeMonotoneSteps(expr.value, { nMax: rawNMax.value }))
const sliderMax = computed(() => Math.max(1, base.value?.samples.length ?? 1))
const localN = ref(1)
watch(sliderMax, (max) => {
  localN.value = Math.min(localN.value, max)
})

const view = computed<MonotoneStepsView | null>(() =>
  computeMonotoneSteps(expr.value, { nMax: rawNMax.value, n: localN.value }),
)

const geometry = computed(() => ({
  width: props.width,
  height: props.height,
  padding: { left: 34, right: 14, top: 30, bottom: 40 },
}))

const seriesValues = computed(() => {
  const samples = base.value?.samples ?? []
  if (samples.length === 0) return [] as Array<{ n: number; value: number }>
  const values = samples.map((sample) => ({ n: sample.n, value: sample.current }))
  const last = samples[samples.length - 1] as (typeof samples)[number]
  values.push({ n: last.n + 1, value: last.next })
  return values
})

const yRange = computed(() => {
  const values = seriesValues.value.map((item) => item.value)
  if (values.length === 0) return { min: 0, max: 1 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = min === max ? 1 : (max - min) * 0.2
  return { min: min - pad, max: max + pad }
})

function toX(n: number): number {
  return projectN(n, geometry.value.width, geometry.value.padding, sliderMax.value + 1)
}
function toY(value: number): number {
  const { padding } = geometry.value
  const innerHeight = geometry.value.height - padding.top - padding.bottom
  const range = yRange.value.max - yRange.value.min || 1
  return padding.top + (1 - (value - yRange.value.min) / range) * innerHeight
}

const plotted = computed(() => seriesValues.value.map((item) => ({ ...item, x: toX(item.n), y: toY(item.value) })))
const path = computed(() => plotted.value.map((point, index) => (index === 0 ? 'M' : 'L') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' '))
const current = computed(() => view.value?.current ?? null)
const currentPoint = computed(() => plotted.value.find((point) => point.n === (current.value?.n ?? -1)) ?? null)
const nextPoint = computed(() => plotted.value.find((point) => point.n === (current.value?.n ?? -1) + 1) ?? null)
const axisBottom = computed(() => geometry.value.height - geometry.value.padding.bottom + 6)

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

const diffText = computed(() => {
  if (!current.value) return '—'
  const sign = current.value.sign > 0 ? '>' : current.value.sign < 0 ? '<' : '='
  return 'uₙ₊₁ − uₙ = ' + fmt(current.value.diff) + '（' + sign + ' 0）'
})

const ticks = computed(() => {
  const max = sliderMax.value + 1
  const stride = Math.max(1, Math.ceil(max / 6))
  const list: number[] = [1]
  for (let n = 1 + stride; n <= max; n += stride) list.push(n)
  return list
})

function labelStyle(x: number, y: number, anchor: 'start' | 'middle' | 'end'): string {
  const transform = anchor === 'start' ? 'translate(0, -50%)' : anchor === 'end' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)'
  return 'left:' + ((x / props.width) * 100).toFixed(2) + '%;top:' + ((y / props.height) * 100).toFixed(2) + '%;transform:' + transform + ';'
}

function onSlider(event: { detail?: { value?: number } } | Event): void {
  const value = Number((event as { detail?: { value?: number } }).detail?.value)
  if (!Number.isFinite(value)) return
  localN.value = Math.min(sliderMax.value, Math.max(1, Math.round(value)))
}
</script>

<template>
  <view class="pg-ms" data-testid="monotone-steps">
    <view v-if="!view" class="pg-perr pg-small" data-testid="monotone-steps-fallback">
      图解数据不可用（表达式无效或缺少 expr 参数）。
    </view>
    <template v-else>
      <view class="pg-svg">
        <svg class="pg-svg__canvas" data-testid="monotone-steps-svg" :viewBox="'0 0 ' + width + ' ' + height" role="img" :aria-label="'单调性相邻项对比：' + diffText">
          <line :x1="geometry.padding.left" :x2="width - geometry.padding.right" :y1="axisBottom" :y2="axisBottom" class="pg-ms__axis" />
          <line :x1="geometry.padding.left" :x2="geometry.padding.left" :y1="geometry.padding.top" :y2="axisBottom" class="pg-ms__axis" />
          <path :d="path" class="pg-ms__line" fill="none" />
          <line
            v-for="n in ticks"
            :key="'tk' + n"
            :x1="toX(n)"
            :x2="toX(n)"
            :y1="axisBottom - 3"
            :y2="axisBottom + 3"
            class="pg-ms__axis"
          />
          <line
            v-if="currentPoint"
            :x1="currentPoint.x"
            :x2="currentPoint.x"
            :y1="geometry.padding.top"
            :y2="axisBottom"
            class="pg-ms__cursor"
          />
          <circle v-for="point in plotted" :key="'pt' + point.n" :cx="point.x" :cy="point.y" r="2.4" class="pg-ms__dot" />
          <circle v-if="currentPoint" :cx="currentPoint.x" :cy="currentPoint.y" r="4.2" class="pg-ms__dot--current" />
          <circle v-if="nextPoint" :cx="nextPoint.x" :cy="nextPoint.y" r="4.2" class="pg-ms__dot--next" />
        </svg>
        <view class="pg-svg__labels" aria-hidden="true">
          <text class="pg-svg__label pg-svg__label--muted" :style="labelStyle(geometry.padding.left, geometry.padding.top - 10, 'start')">
            比较 uₙ 与 uₙ₊₁（只展示差值，不做收敛判定）
          </text>
          <text class="pg-svg__label pg-svg__label--ink" :style="labelStyle(geometry.padding.left, axisBottom + 22, 'start')">
            n = {{ view.n }}：uₙ = {{ fmt(current?.current) }} → uₙ₊₁ = {{ fmt(current?.next) }}，差值 {{ fmt(current?.diff) }}
          </text>
          <text
            v-for="n in ticks"
            :key="'tk-' + n"
            class="pg-svg__label pg-svg__label--tick"
            :style="labelStyle(toX(n), axisBottom + 12, 'middle')"
          >{{ n }}</text>
        </view>
      </view>

      <slider
        class="pg-ms__slider"
        data-testid="monotone-steps-slider"
        :min="1"
        :max="sliderMax"
        :step="1"
        :value="localN"
        :show-value="false"
        active-color="#2b4fa3"
        background-color="#e2e4e8"
        block-size="20"
        @changing="onSlider"
        @change="onSlider"
      />
      <view class="pg-ms__readout">
        <text class="pg-ms__mono pg-small" data-testid="monotone-steps-diff">{{ diffText }}</text>
        <text class="pg-ms__mono pg-small" data-testid="monotone-steps-direction">{{ view.directionLabel }}</text>
      </view>
      <text class="pg-ms__note pg-small" data-testid="monotone-steps-note">
        差值符号只用于直观展示；单调性/收敛性的判定以服务端与证明为准。
      </text>
    </template>
  </view>
</template>

<style scoped>
.pg-ms { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-perr { color: var(--ink-2); }
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
.pg-svg__label--ink { color: var(--ink); font-size: 9px; }
.pg-svg__label--tick { color: var(--ink-2); font-size: 9px; }
.pg-ms__axis { stroke: var(--rule); stroke-width: 1; }
.pg-ms__line { stroke: var(--accent); stroke-width: 1.6; }
.pg-ms__cursor { stroke: var(--margin); stroke-width: 1; stroke-dasharray: 2 3; }
.pg-ms__dot { fill: var(--ink-2); }
.pg-ms__dot--current { fill: var(--accent); }
.pg-ms__dot--next { fill: var(--ok); }
.pg-ms__slider { width: 100%; }
.pg-ms__readout { display: flex; justify-content: space-between; gap: var(--sp-2); flex-wrap: wrap; }
.pg-ms__mono { font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
.pg-ms__note { color: var(--ink-2); }
</style>
