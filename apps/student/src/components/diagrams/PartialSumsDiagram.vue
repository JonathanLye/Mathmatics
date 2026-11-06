<script setup lang="ts">
/**
 * 部分和折线图（03 §7 的 partial-sums）：一条或多条级数的部分和 Sₙ。
 *
 * - 纯计算在 ./partialSums.ts（累加/坐标范围）；表达式用 ./expr.ts 受限解析，绝不 eval。
 * - 拖动 n 上限滑块只看前 n 项累加；不做收敛判定（只展示）。
 * - SVG 只画图形，文字用 HTML 叠层（uni-app H5 会把模板 <text> 当内置组件编译）。
 */
import { computed, ref, watch } from 'vue'
import MathText from '@ui-math/MathText.vue'
import type { VisualSpec } from '@/types/attempt'
import { clampInt, computePartialSums, projectPartialSum, type PartialSumsView } from './partialSums'
import { useThemeToken } from '@/composables/useThemeToken'
import { FALLBACK_TOKEN } from '@/utils/themeTokens'

const sliderAccent = useThemeToken('--accent', FALLBACK_TOKEN.accent)
const sliderRule = useThemeToken('--rule', FALLBACK_TOKEN.rule)

const props = withDefaults(defineProps<{ spec?: VisualSpec | null; width?: number; height?: number }>(), {
  spec: null,
  width: 320,
  height: 200,
})

const geometry = computed(() => ({
  width: props.width,
  height: props.height,
  padding: { left: 36, right: 16, top: 30, bottom: 42 },
}))
const sliderMax = computed(() => clampInt(props.spec?.params?.nMax, 5, 400, 30))
const localN = ref(sliderMax.value)
watch(sliderMax, (max) => {
  localN.value = Math.min(localN.value, max)
})

const view = computed<PartialSumsView | null>(() =>
  computePartialSums(props.spec?.params?.series, { nMax: sliderMax.value, n: localN.value }),
)

const yRangeValue = computed(() => (view.value ? view.value.yMax - view.value.yMin || 1 : 1))
function toY(value: number): number {
  if (!view.value) return 0
  const { padding } = geometry.value
  const innerHeight = geometry.value.height - padding.top - padding.bottom
  return padding.top + (1 - (value - view.value.yMin) / yRangeValue.value) * innerHeight
}
const axisBottom = computed(() => geometry.value.height - geometry.value.padding.bottom + 6)

const LINE_CLASS = ['pg-ps__line--accent', 'pg-ps__line--margin', 'pg-ps__line--ok']

const drawn = computed(() =>
  (view.value?.series ?? [])
    .filter((series) => series.valid)
    .map((series, index) => {
      const points = series.points.slice(0, view.value?.n ?? 0)
      const projected = points.map((point) => projectPartialSum(point, geometry.value, view.value as PartialSumsView))
      const path = projected.map((point, pointIndex) => (pointIndex === 0 ? 'M' : 'L') + point.x.toFixed(1) + ' ' + point.y.toFixed(1)).join(' ')
      return {
        key: series.label + '-' + index,
        label: series.label,
        path,
        projected,
        last: points[points.length - 1] ?? null,
        lineClass: LINE_CLASS[index % LINE_CLASS.length],
      }
    }),
)

const xTickPoints = computed(() =>
  (view.value?.xTicks ?? []).map((n) => ({ n, x: projectPartialSum({ n, value: 0 }, geometry.value, view.value as PartialSumsView).x })),
)

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

const ariaLabel = computed(() => {
  if (!view.value) return '部分和图解：数据不可用'
  const parts = view.value.series
    .filter((series) => series.valid)
    .map((series) => series.label + '：S_' + view.value?.n + ' = ' + fmt(series.finalSum))
  return '部分和图解（只展示前 ' + view.value.n + ' 项）：' + parts.join('；')
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
  <view class="pg-ps" data-testid="partial-sums">
    <view v-if="!view" class="pg-perr pg-small" data-testid="partial-sums-fallback">
      图解数据不可用（表达式无效或缺少 series 参数）。
    </view>
    <template v-else>
      <view class="pg-svg">
        <svg class="pg-svg__canvas" data-testid="partial-sums-svg" :viewBox="'0 0 ' + width + ' ' + height" role="img" :aria-label="ariaLabel">
          <line :x1="geometry.padding.left" :x2="width - geometry.padding.right" :y1="axisBottom" :y2="axisBottom" class="pg-ps__axis" />
          <line :x1="geometry.padding.left" :x2="geometry.padding.left" :y1="geometry.padding.top" :y2="axisBottom" class="pg-ps__axis" />
          <line
            v-for="tick in xTickPoints"
            :key="'xt' + tick.n"
            :x1="tick.x"
            :x2="tick.x"
            :y1="axisBottom - 3"
            :y2="axisBottom + 3"
            class="pg-ps__axis"
          />
          <path v-for="line in drawn" :key="line.key" :d="line.path" :class="['pg-ps__line', line.lineClass]" fill="none" />
          <circle
            v-for="line in drawn"
            :key="'dot-' + line.key"
            :cx="line.projected[line.projected.length - 1]?.x ?? 0"
            :cy="line.projected[line.projected.length - 1]?.y ?? 0"
            r="3.2"
            :class="['pg-ps__dot', line.lineClass]"
          />
        </svg>
        <view class="pg-svg__labels" aria-hidden="true">
          <text
            v-for="(line, lineIndex) in drawn"
            :key="'lb-' + line.key"
            class="pg-svg__label"
            :class="line.lineClass === 'pg-ps__line--accent' ? 'pg-svg__label--ink' : 'pg-svg__label--muted'"
            :style="labelStyle(
              geometry.padding.left,
              geometry.padding.top + 4 + lineIndex * 14,
              'start',
            )"
          >{{ ['①', '②', '③'][lineIndex] ?? '' }} S{{ view.n }} = {{ fmt(line.last?.value ?? null) }}</text>
          <text
            v-for="tick in xTickPoints"
            :key="'tk-' + tick.n"
            class="pg-svg__label pg-svg__label--tick"
            :style="labelStyle(tick.x, axisBottom + 14, 'middle')"
          >{{ tick.n }}</text>
          <text
            class="pg-svg__label pg-svg__label--muted"
            :style="labelStyle(width - geometry.padding.right, axisBottom + 30, 'end')"
          >只累加到 n = {{ view.n }} / {{ view.nMax }}（拖动滑块）</text>
        </view>
      </view>

      <slider
        class="pg-ps__slider"
        data-testid="partial-sums-slider"
        :min="1"
        :max="sliderMax"
        :step="1"
        :value="localN"
        :show-value="false"
        :active-color="sliderAccent"
        :background-color="sliderRule"
        block-size="20"
        @changing="onSlider"
        @change="onSlider"
      />
      <view class="pg-ps__readout" data-testid="partial-sums-readout">
        <text class="pg-ps__mono pg-small">n = {{ view.n }} / {{ view.nMax }}</text>
        <view
          v-for="(line, lineIndex) in drawn"
          :key="'ro-' + line.key"
          class="pg-ps__legend"
          :data-testid="'partial-sums-series-' + lineIndex"
        >
          <text class="pg-ps__mono pg-small">{{ ['①', '②', '③'][lineIndex] ?? '' }} S{{ view.n }} = {{ fmt(line.last?.value ?? null) }}</text>
          <MathText :text="line.label" class="pg-ps__legendlabel" />
        </view>
      </view>
      <text class="pg-ps__note pg-small" data-testid="partial-sums-note">
        折线是部分和 Sₙ = a₁ + … + aₙ（只展示前 n 项累加，不做收敛判定）。
      </text>
    </template>
  </view>
</template>

<style scoped>
.pg-ps { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-perr { color: var(--ink-2); }
.pg-svg { position: relative; width: 100%; }
.pg-svg__canvas { width: 100%; height: auto; display: block; }
.pg-svg__labels { position: absolute; inset: 0; pointer-events: none; }
.pg-svg__label {
  position: absolute;
  font-family: var(--font-mono);
  font-size: var(--fs-svg);
  line-height: 1.2;
  white-space: nowrap;
  color: var(--ink);
}
.pg-svg__label--muted { color: var(--ink-2); font-size: var(--fs-svg-small); }
.pg-svg__label--ink { color: var(--ink); }
.pg-svg__label--tick { color: var(--ink-2); font-size: var(--fs-svg-small); }
.pg-ps__axis { stroke: var(--rule); stroke-width: 1; }
.pg-ps__line { stroke-width: 1.6; }
.pg-ps__line--accent { stroke: var(--accent); }
.pg-ps__line--margin { stroke: var(--sea); }
.pg-ps__line--ok { stroke: var(--ok); }
.pg-ps__dot--accent { fill: var(--accent); }
.pg-ps__dot--margin { fill: var(--sea); }
.pg-ps__dot--ok { fill: var(--ok); }
.pg-ps__slider { width: 100%; }
.pg-ps__readout { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-ps__legend { display: flex; align-items: baseline; gap: var(--sp-2); flex-wrap: wrap; }
.pg-ps__legendlabel { color: var(--ink-2); font-size: var(--fs-13); }
.pg-ps__mono { font-family: var(--font-mono); color: var(--ink); white-space: nowrap; }
.pg-ps__note { color: var(--ink-2); }
</style>
