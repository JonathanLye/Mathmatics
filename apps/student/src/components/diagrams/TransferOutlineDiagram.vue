<script setup lang="ts">
/**
 * 迁移题思路图（issue #47 P1-2「更多图解模板」之三；L5 迁移题，01 §L5）。
 *
 * 以 seed 题对 epsN（数列 ε-N）→ epsN-T1（函数 ε-δ）为例：
 * 两题证明骨架相同（任取 ε → 取只依赖 ε 的阈值 → 进入阈值范围 → |·−A|<ε），
 * 只需把"项号超过整数阈值"换成"x 进入去心邻域"。左右两栏逐行对照。
 * 纯函数在 ./transfer.ts，组件只负责渲染；不显示任何题目的关键步骤内容（01「系统禁止」）。
 *
 * 注：uni-app H5 会把模板里的 <text> 当内置组件编译进 SVG（文字不渲染），
 * 因此 SVG 只画图形，文字用 HTML 叠层（.pg-svg__label）渲染。
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
    '迁移题思路对照：数列 ε-N 与函数 ε-δ。ε=' +
    fmt(props.epsilon) +
    ' 时，N=' +
    fmt(quantities.value.seqN) +
    '，δ=' +
    fmt(quantities.value.funcDelta) +
    '；两边骨架相同，只换量化对象。',
)

interface OverlayLabel {
  id: string
  x: number
  y: number
  text: string
  anchor: 'start' | 'middle' | 'end'
  kind: 'head' | 'text' | 'link'
}

const labels = computed<OverlayLabel[]>(() => {
  const list: OverlayLabel[] = [
    { id: 'head-seq', x: props.width / 4, y: 14, text: '数列极限 · ε-N', anchor: 'middle', kind: 'head' },
    { id: 'head-func', x: (props.width * 3) / 4, y: 14, text: '函数极限 · ε-δ', anchor: 'middle', kind: 'head' },
  ]
  rows.value.forEach((row, index) => {
    const y = 48 + index * 30
    list.push({ id: 'seq-' + index, x: leftX, y, text: row.seq, anchor: 'start', kind: 'text' })
    list.push({ id: 'func-' + index, x: rightX.value, y, text: row.func, anchor: 'start', kind: 'text' })
    list.push({ id: 'link-' + index, x: centerX.value, y, text: '≙', anchor: 'middle', kind: 'link' })
  })
  return list
})

function labelStyle(label: OverlayLabel): string {
  const anchor = label.anchor === 'start' ? 'translate(0, -50%)' : label.anchor === 'end' ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)'
  return 'left:' + ((label.x / props.width) * 100).toFixed(2) + '%;top:' + ((label.y / height.value) * 100).toFixed(2) + '%;transform:' + anchor + ';'
}
</script>

<template>
  <view class="pg-transfer">
    <view class="pg-svg" data-testid="transfer-outline-svg">
      <svg
        class="pg-svg__canvas"
        :viewBox="'0 0 ' + width + ' ' + height"
        role="img"
        :aria-label="ariaLabel"
      >
        <!-- 两栏标题底色 -->
        <rect x="6" y="4" :width="width / 2 - 12" height="20" rx="4" class="pg-svg__headrect" />
        <rect :x="width / 2 + 6" y="4" :width="width / 2 - 12" height="20" rx="4" class="pg-svg__headrect" />
        <!-- 逐行分隔线 -->
        <line
          v-for="(row, index) in rows"
          :key="'rule' + index"
          :x1="leftX"
          :x2="width - 10"
          :y1="58 + index * 30"
          :y2="58 + index * 30"
          class="pg-svg__rule"
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
.pg-svg__label--head { font-family: var(--font-serif); color: var(--ink); }
.pg-svg__label--text { color: var(--ink); }
.pg-svg__label--link { color: var(--accent-text); font-size: var(--fs-12); }
.pg-svg__headrect { fill: var(--accent-soft); }
.pg-svg__rule { stroke: var(--rule); stroke-width: 0.6; }
.pg-transfer__caption { color: var(--ink-2); }
.pg-transfer__rows { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-transfer__row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-1); padding: var(--sp-2) var(--sp-3); }
.pg-transfer__seq { color: var(--accent-text); font-family: var(--font-mono); }
.pg-transfer__func { color: var(--sea-text); font-family: var(--font-mono); }
.pg-transfer__arrow { color: var(--ink-2); }
.pg-transfer__note { flex-basis: 100%; color: var(--ink-2); }
.pg-sheet { background: var(--sheet); border: var(--bw) solid var(--rule); border-radius: var(--radius-16); }
</style>
