<script setup lang="ts">
/**
 * 迁移题思路图（issue #47 P1-2「更多图解模板」之三；L5 迁移题，01 §L5）。
 *
 * 以 seed 题对 epsN（数列 ε-N）→ epsN-T1（函数 ε-δ）为例：
 * 两题证明骨架相同（任取 ε → 取只依赖 ε 的阈值 → 进入阈值范围 → |·−A|<ε），
 * 只需把"项号超过整数阈值"换成"x 进入去心邻域"。左右两栏逐行对照。
 * 纯函数在 ./transfer.ts，组件只负责渲染；不显示任何题目的关键步骤内容（01 §系统禁止）。
 */
import { computed } from 'vue'

import { transferQuantities, transferRows } from './transfer'

const props = withDefaults(
  defineProps<{
    /** 误差要求 ε > 0 */
    epsilon?: number
    /** 数列题的分子系数 k（epsN 的 |a_n−3| = 5/(n+2)） */
    kSeq?: number
    /** 函数题的斜率（epsN-T1 的 |(2x+1)−3| = 2|x−1|） */
    slope?: number
    /** 函数题的极限点 x0（epsN-T1 是 1） */
    funcCenter?: number
    width?: number
  }>(),
  { epsilon: 0.1, kSeq: 5, slope: 2, funcCenter: 1, width: 320 },
)

const quantities = computed(() =>
  transferQuantities(props.epsilon, { kSeq: props.kSeq, slope: props.slope, funcCenter: props.funcCenter }),
)
const rows = computed(() => transferRows(quantities.value, { kSeq: props.kSeq, slope: props.slope, funcCenter: props.funcCenter }))
const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4))))
// 02 §4.9：图解区高度 ≥ 屏宽 × 0.6（320 × 0.6 ≈ 192）
const height = computed(() => Math.max(196, 26 + rows.value.length * 30 + 18))
const leftX = 10
const rightX = computed(() => props.width / 2 + 16)
const centerX = computed(() => props.width / 2 - 2)
const ariaLabel = computed(
  () =>
    `迁移题思路对照：数列 ε-N 与函数 ε-δ。ε=${fmt(props.epsilon)} 时，N=${fmt(quantities.value.seqN)}，` +
    `δ=${fmt(quantities.value.funcDelta)}；两边骨架相同，只换量化对象。`,
)
</script>

<template>
  <view class="pg-transfer">
    <svg class="pg-transfer__svg" :viewBox="`0 0 ${width} ${height}`" role="img" :aria-label="ariaLabel">
      <!-- 两栏标题 -->
      <rect x="6" y="4" :width="width / 2 - 12" height="20" rx="4" class="pg-transfer__head" />
      <rect :x="width / 2 + 6" y="4" :width="width / 2 - 12" height="20" rx="4" class="pg-transfer__head" />
      <text :x="width / 4" y="18" class="pg-transfer__headtext" text-anchor="middle">数列极限 · ε-N</text>
      <text :x="(width * 3) / 4" y="18" class="pg-transfer__headtext" text-anchor="middle">函数极限 · ε-δ</text>

      <!-- 逐行对照；中间的 ≙ 表示同构 -->
      <g v-for="(row, index) in rows" :key="index">
        <text :x="leftX" :y="52 + index * 30" class="pg-transfer__text" text-anchor="start">{{ row.seq }}</text>
        <text :x="rightX" :y="52 + index * 30" class="pg-transfer__text" text-anchor="start">{{ row.func }}</text>
        <text :x="centerX" :y="52 + index * 30" class="pg-transfer__link" text-anchor="middle">≙</text>
        <line
          :x1="leftX"
          :x2="width - 10"
          :y1="58 + index * 30"
          :y2="58 + index * 30"
          class="pg-transfer__rule"
        />
      </g>
    </svg>

    <text class="pg-transfer__caption pg-small">
      同一副骨架：ε 定误差 → 阈值只依赖 ε（N = ⌈{{ fmt(kSeq) }}/ε⌉ = {{ fmt(quantities.seqN) }}，
      δ = ε/{{ fmt(slope) }} = {{ fmt(quantities.funcDelta) }}）→ 进入阈值范围 → |·−A| &lt; ε。
    </text>

    <view class="pg-transfer__rows">
      <view v-for="(row, index) in rows" :key="index" class="pg-transfer__row pg-sheet">
        <text class="pg-transfer__seq pg-small">{{ row.seq }}</text>
        <text class="pg-transfer__arrow pg-small">↔</text>
        <text class="pg-transfer__func pg-small">{{ row.func }}</text>
        <text class="pg-transfer__note pg-small">{{ row.note }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-transfer { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-transfer__svg { width: 100%; height: auto; display: block; }
.pg-transfer__head { fill: var(--accent-soft); }
.pg-transfer__headtext { fill: var(--ink); font-family: var(--font-serif); font-size: 10px; }
.pg-transfer__text { fill: var(--ink); font-family: var(--font-mono); font-size: 9.5px; }
.pg-transfer__link { fill: var(--accent); font-size: 11px; }
.pg-transfer__rule { stroke: var(--rule); stroke-width: 0.6; }
.pg-transfer__caption { color: var(--ink-2); }
.pg-transfer__rows { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-transfer__row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-1); padding: var(--sp-2) var(--sp-3); }
.pg-transfer__seq { color: var(--accent); font-family: var(--font-mono); }
.pg-transfer__func { color: var(--margin); font-family: var(--font-mono); }
.pg-transfer__arrow { color: var(--ink-2); }
.pg-transfer__note { flex-basis: 100%; color: var(--ink-2); }
.pg-sheet { background: var(--sheet); border: 1px solid var(--rule); border-radius: var(--radius-card); }
</style>
