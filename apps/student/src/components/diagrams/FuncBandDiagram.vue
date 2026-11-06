<script setup lang="ts">
/**
 * 函数图像 + ε-δ 带子（03 §7 的 func-band）。
 *
 * - 参数：params.expr / limit(A) / at(x₀) / epsilon{min,max,init,step} / xRange / yRange；
 * - 水平带 A±ε；竖直带 x₀±δ；δ 由 ./funcBand.ts 数值扫描（步长 1e-3）得到，标注「数值近似」；
 * - 只渲染/数值展示，不做任何判定；表达式走 ./expr.ts 受限解析，绝不 eval。
 * - uni-app H5 注意：SVG 里不放 <text>，文字用 HTML 叠层。
 */
import { computed, ref, watch } from 'vue'
import type { VisualSpec } from '@/types/attempt'
import {
  computeFuncBand,
  projectFuncBandPoint,
  readFuncBandSpec,
  type FuncBandSpec,
  type FuncBandView,
} from './funcBand'
import { useThemeToken } from '@/composables/useThemeToken'
import { FALLBACK_TOKEN } from '@/utils/themeTokens'

const sliderAccent = useThemeToken('--accent', FALLBACK_TOKEN.accent)
const sliderRule = useThemeToken('--rule', FALLBACK_TOKEN.rule)

const props = withDefaults(defineProps<{ spec?: VisualSpec | null; width?: number; height?: number }>(), {
  spec: null,
  width: 320,
  height: 220,
})

const spec = computed<FuncBandSpec | null>(() => readFuncBandSpec(props.spec?.params))
const localEps = ref(spec.value?.epsilon.init ?? 0.4)
watch(spec, (next) => {
  localEps.value = next ? Math.min(next.epsilon.max, Math.max(next.epsilon.min, next.epsilon.init)) : 0.4
})

const geometry = computed(() => ({
  width: props.width,
  height: props.height,
  padding: { left: 40, right: 16, top: 30, bottom: 40 },
}))

const view = computed<FuncBandView | null>(() =>
  spec.value ? computeFuncBand(props.spec?.params, { epsilon: localEps.value }) : null,
)

const mapped = computed(() =>
  (view.value?.points ?? []).map((point) => ({ ...point, ...projectFuncBandPoint(point, geometry.value, view.value as FuncBandView) })),
)
const curvePath = computed(() =>
  mapped.value.map((point, index) => (index === 0 ? 'M' : 'L') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' '),
)

const yRangeValue = computed(() => (view.value ? view.value.yRange[1] - view.value.yRange[0] || 1 : 1))
const xRangeValue = computed(() => (view.value ? view.value.xRange[1] - view.value.xRange[0] || 1 : 1))

function toY(value: number): number {
  if (!view.value) return 0
  const { padding } = geometry.value
  const innerHeight = geometry.value.height - padding.top - padding.bottom
  return padding.top + (1 - (value - view.value.yRange[0]) / yRangeValue.value) * innerHeight
}
function toX(value: number): number {
  if (!view.value) return 0
  const { padding } = geometry.value
  const innerWidth = geometry.value.width - padding.left - padding.right
  return padding.left + ((value - view.value.xRange[0]) / xRangeValue.value) * innerWidth
}

const bandTop = computed(() => (view.value ? toY(view.value.bandHigh) : 0))
const bandBottom = computed(() => (view.value ? toY(view.value.bandLow) : 0))
const xBandLeft = computed(() => (view.value && view.value.delta !== null ? toX(view.value.at - view.value.delta) : null))
const xBandRight = computed(() => (view.value && view.value.delta !== null ? toX(view.value.at + view.value.delta) : null))
const xAt = computed(() => (view.value ? toX(view.value.at) : 0))
const yLimit = computed(() => (view.value ? toY(view.value.limit) : 0))

const xTicks = computed(() => (view.value?.xTicks ?? []).map((value) => ({ value, x: toX(value) })))
const yTicks = computed(() => (view.value?.yTicks ?? []).map((value) => ({ value, y: toY(value) })))

function fmt(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(digits)))
}

const deltaText = computed(() => (view.value?.delta === null || view.value?.delta === undefined ? '—' : fmt(view.value.delta, 3)))
const ariaLabel = computed(() => {
  if (!view.value) return '函数带子图解：数据不可用'
  return (
    'ε-δ 图解：A=' + fmt(view.value.limit) + '，x₀=' + fmt(view.value.at) + '，ε=' + fmt(view.value.epsilon, 2) +
    '，δ≈' + deltaText.value + '（数值扫描近似，步长 1e-3）'
  )
})

function labelStyle(x: number, y: number, anchor: 'start' | 'middle' | 'end'): string {
  const transform = anchor === 'start' ? 'translate(0, -50%)' : anchor === 'end' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)'
  return 'left:' + ((x / props.width) * 100).toFixed(2) + '%;top:' + ((y / props.height) * 100).toFixed(2) + '%;transform:' + transform + ';'
}

function onSlider(event: { detail?: { value?: number } } | Event): void {
  const value = Number((event as { detail?: { value?: number } }).detail?.value)
  if (!Number.isFinite(value)) return
  const range = spec.value?.epsilon
  localEps.value = range ? Math.min(range.max, Math.max(range.min, value)) : value
}
</script>

<template>
  <view class="pg-fb" data-testid="func-band">
    <view v-if="!view" class="pg-perr pg-small" data-testid="func-band-fallback">
      图解数据不可用（表达式无效或缺少 limit/at 参数）。
    </view>
    <template v-else>
      <view class="pg-svg">
        <svg class="pg-svg__canvas" data-testid="func-band-svg" :viewBox="'0 0 ' + width + ' ' + height" role="img" :aria-label="ariaLabel">
          <rect :x="geometry.padding.left" :y="bandTop" :width="width - geometry.padding.left - geometry.padding.right" :height="Math.max(0, bandBottom - bandTop)" class="pg-fb__hband" />
          <rect
            v-if="xBandLeft !== null && xBandRight !== null"
            :x="Math.min(xBandLeft, xBandRight)"
            :y="geometry.padding.top"
            :width="Math.max(1, Math.abs(xBandRight - xBandLeft))"
            :height="height - geometry.padding.top - geometry.padding.bottom + 6"
            class="pg-fb__vband"
          />
          <line :x1="geometry.padding.left" :x2="width - geometry.padding.right" :y1="yLimit" :y2="yLimit" class="pg-fb__center" />
          <line :x1="xAt" :x2="xAt" :y1="geometry.padding.top" :y2="height - geometry.padding.bottom + 6" class="pg-fb__xzero" />
          <line :x1="geometry.padding.left" :x2="width - geometry.padding.right" :y1="height - geometry.padding.bottom + 6" :y2="height - geometry.padding.bottom + 6" class="pg-fb__axis" />
          <line :x1="geometry.padding.left" :x2="geometry.padding.left" :y1="geometry.padding.top" :y2="height - geometry.padding.bottom + 6" class="pg-fb__axis" />
          <path :d="curvePath" class="pg-fb__curve" fill="none" />
          <line
            v-for="tick in xTicks"
            :key="'xt' + tick.value"
            :x1="tick.x"
            :x2="tick.x"
            :y1="height - geometry.padding.bottom + 3"
            :y2="height - geometry.padding.bottom + 9"
            class="pg-fb__axis"
          />
          <line
            v-for="tick in yTicks"
            :key="'yt' + tick.value"
            :x1="geometry.padding.left - 3"
            :x2="geometry.padding.left + 3"
            :y1="tick.y"
            :y2="tick.y"
            class="pg-fb__axis"
          />
        </svg>
        <view class="pg-svg__labels" aria-hidden="true">
          <text class="pg-svg__label pg-svg__label--muted" :style="labelStyle(geometry.padding.left, geometry.padding.top - 10, 'start')">
            水平带 A±ε：{{ fmt(view.bandLow, 2) }} ~ {{ fmt(view.bandHigh, 2) }}
          </text>
          <text class="pg-svg__label pg-svg__label--ink" :style="labelStyle(width - geometry.padding.right, yLimit - 8, 'end')">
            A = {{ fmt(view.limit, 2) }}
          </text>
          <text class="pg-svg__label pg-svg__label--muted" :style="labelStyle(xAt + 4, geometry.padding.top + 8, 'start')">
            x₀ = {{ fmt(view.at, 2) }}
          </text>
          <text
            v-if="xBandRight !== null"
            class="pg-svg__label pg-svg__label--margin"
            :style="labelStyle(xBandRight + 4, height - geometry.padding.bottom - 6, 'start')"
          >δ ≈ {{ deltaText }}（数值近似）</text>
          <text
            v-for="tick in xTicks"
            :key="'tk-' + tick.value"
            class="pg-svg__label pg-svg__label--tick"
            :style="labelStyle(tick.x, height - geometry.padding.bottom + 22, 'middle')"
          >{{ fmt(tick.value, 1) }}</text>
          <text
            v-for="tick in yTicks"
            :key="'lky-' + tick.value"
            class="pg-svg__label pg-svg__label--tick"
            :style="labelStyle(geometry.padding.left - 6, tick.y, 'end')"
          >{{ fmt(tick.value, 1) }}</text>
        </view>
      </view>

      <slider
        class="pg-fb__slider"
        data-testid="func-band-slider"
        :min="spec?.epsilon.min ?? 0.05"
        :max="spec?.epsilon.max ?? 0.8"
        :step="spec?.epsilon.step ?? 0.01"
        :value="localEps"
        :show-value="false"
        :active-color="sliderAccent"
        :background-color="sliderRule"
        block-size="20"
        @changing="onSlider"
        @change="onSlider"
      />
      <view class="pg-fb__readout">
        <text class="pg-fb__mono pg-small" data-testid="func-band-eps">ε = {{ fmt(view.epsilon, 2) }}</text>
        <text class="pg-fb__mono pg-small" data-testid="func-band-delta">δ ≈ {{ deltaText }}</text>
      </view>
      <text class="pg-fb__note pg-small" data-testid="func-band-note">
        δ 由数值扫描得到（步长 1e-3，标注「数值近似」），只用于直观展示；严格 δ 要由证明给出。
      </text>
    </template>
  </view>
</template>

<style scoped>
.pg-fb { display: flex; flex-direction: column; gap: var(--sp-2); }
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
.pg-svg__label--ink { color: var(--ink); }
.pg-svg__label--margin { color: var(--margin-text); font-size: 9px; }
.pg-svg__label--tick { color: var(--ink-2); font-size: 9px; }
.pg-fb__hband { fill: var(--accent-soft); }
.pg-fb__vband { fill: var(--ok); opacity: 0.14; }
.pg-fb__axis { stroke: var(--rule); stroke-width: 1; }
.pg-fb__center { stroke: var(--ink-2); stroke-width: 1; stroke-dasharray: 4 3; }
.pg-fb__xzero { stroke: var(--margin); stroke-width: 1; stroke-dasharray: 2 3; }
.pg-fb__curve { stroke: var(--accent); stroke-width: 1.8; }
.pg-fb__slider { width: 100%; }
.pg-fb__readout { display: flex; justify-content: space-between; gap: var(--sp-2); flex-wrap: wrap; }
.pg-fb__mono { font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
.pg-fb__note { color: var(--ink-2); }
</style>
