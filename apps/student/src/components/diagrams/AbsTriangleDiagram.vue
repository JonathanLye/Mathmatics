<script setup lang="ts">
/**
 * 绝对值展开 / 三角不等式图解（issue #47 P1-2「更多图解模板」之一）。
 *
 * 数学含义见 ./absTriangle.ts：
 * - 上两行在数轴上画 a、b 两段与合位移 a+b；
 * - 下面一行对照 |a+b| 与 |a|+|b|：等号只在 a、b 同号时成立，异号时 |a+b| 更短。
 * 颜色语义（02 §2）：--accent 合位移、--ink-2 两段路程、--margin 异号时多走的路。
 */
import { computed } from 'vue'

import { mapX, niceSpan, niceStep, spanOf, triangleBounds } from './absTriangle'

const props = withDefaults(
  defineProps<{
    /** 第一个数 a（数轴上有符号） */
    a?: number
    /** 第二个数 b（数轴上有符号） */
    b?: number
    width?: number
    height?: number
  }>(),
  // 02 §4.9：图解区高度 ≥ 屏宽 × 0.6（320 × 0.6 ≈ 192）
  { a: 3, b: -1, width: 320, height: 196 },
)

const PADDING = 18
const bounds = computed(() => triangleBounds(props.a, props.b))
const span = computed(() =>
  niceSpan(spanOf([0, props.a, props.b, props.a + props.b, -bounds.value.absTotal, bounds.value.absTotal])),
)
const toX = (value: number) => mapX(value, span.value, props.width, PADDING)
const zeroX = computed(() => toX(0))
const axisY = computed(() => props.height - 32)
const ticks = computed(() => {
  const step = niceStep(span.value.max - span.value.min, 4)
  const values: number[] = []
  const start = Math.ceil(span.value.min / step) * step
  for (let value = start; value <= span.value.max + step / 2; value += step) values.push(Number(value.toFixed(6)))
  return values
})
const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))))
const ariaLabel = computed(
  () =>
    `绝对值与三角不等式：a=${props.a}，b=${props.b}；|a+b|=${fmt(bounds.value.absSum)}，` +
    `|a|+|b|=${fmt(bounds.value.absTotal)}，${bounds.value.equality ? '等号成立' : `差 ${fmt(bounds.value.gap)}`}。`,
)
</script>

<template>
  <view class="pg-abs">
    <svg class="pg-abs__svg" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="ariaLabel">
      <!-- 数轴与刻度 -->
      <line :x1="toX(span.min)" :x2="toX(span.max)" :y1="axisY" :y2="axisY" class="pg-abs__axis" />
      <g v-for="tick in ticks" :key="tick">
        <line :x1="toX(tick)" :x2="toX(tick)" :y1="axisY - 3" :y2="axisY + 3" class="pg-abs__axis" />
        <text :x="toX(tick)" :y="height - 10" class="pg-abs__tick" text-anchor="middle">{{ tick }}</text>
      </g>

      <!-- 第 1 行：0 → a → a+b，两段路程 |a|、|b| -->
      <line :x1="zeroX" :x2="toX(a)" :y1="24" :y2="24" class="pg-abs__seg pg-abs__seg--accent" />
      <line :x1="toX(a)" :x2="toX(a + b)" :y1="24" :y2="24" class="pg-abs__seg pg-abs__seg--ink" />
      <text :x="toX(a / 2)" :y="16" class="pg-abs__label" text-anchor="middle">|a| = {{ fmt(bounds.absA) }}</text>
      <text :x="toX(a + b / 2)" :y="16" class="pg-abs__label" text-anchor="middle">|b| = {{ fmt(bounds.absB) }}</text>

      <!-- 第 2 行：直接走 0 → a+b，合位移 |a+b| -->
      <line :x1="zeroX" :x2="toX(a + b)" :y1="58" :y2="58" class="pg-abs__seg pg-abs__seg--margin" />
      <text :x="toX((a + b) / 2)" :y="74" class="pg-abs__label" text-anchor="middle">|a + b| = {{ fmt(bounds.absSum) }}</text>

      <!-- 第 3 行：|a|+|b| 与 |a+b| 的对照；异号时多出来的那段就是 gap -->
      <line :x1="zeroX" :x2="toX(bounds.absTotal)" :y1="96" :y2="96" class="pg-abs__seg pg-abs__seg--soft" />
      <line :x1="zeroX" :x2="toX(bounds.absSum)" :y1="110" :y2="110" class="pg-abs__seg pg-abs__seg--accent" />
      <text :x="toX(bounds.absTotal / 2)" :y="90" class="pg-abs__label" text-anchor="middle">
        |a| + |b| = {{ fmt(bounds.absTotal) }}
      </text>
      <text :x="toX(bounds.absSum / 2)" :y="126" class="pg-abs__label pg-abs__label--small" text-anchor="middle">
        |a + b| = {{ fmt(bounds.absSum) }}
      </text>
    </svg>

    <text class="pg-abs__caption pg-small">
      {{ bounds.equality ? '等号成立：a、b 同号（或至少一个为 0）' : `异号：|a+b| 比 |a|+|b| 少 ${fmt(bounds.gap)}（图上标红的合位移更短）` }}
    </text>
  </view>
</template>

<style scoped>
.pg-abs { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-abs__svg { width: 100%; height: auto; display: block; }
.pg-abs__axis { stroke: var(--rule); stroke-width: 1; }
.pg-abs__tick { fill: var(--ink-2); font-family: var(--font-mono); font-size: 9px; }
.pg-abs__seg { stroke-width: 7; stroke-linecap: round; }
.pg-abs__seg--accent { stroke: var(--accent); }
.pg-abs__seg--ink { stroke: var(--ink-2); }
.pg-abs__seg--margin { stroke: var(--margin); }
.pg-abs__seg--soft { stroke: var(--accent-soft); stroke-width: 10; }
.pg-abs__label { fill: var(--ink); font-family: var(--font-mono); font-size: 10px; }
.pg-abs__label--small { fill: var(--ink-2); font-size: 9px; }
.pg-abs__caption { color: var(--ink-2); }
</style>
