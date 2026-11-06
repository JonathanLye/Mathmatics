<script setup lang="ts">
/**
 * 六步路径插画：小方沿弯弯的路走过六个站点，走到的站点依次点亮。
 * 全部是 CSS 关键帧（只动 left/top 和 transform/颜色），所以“减少动态效果”和我的页动效开关会把它收成最后一帧：
 * 小方站在终点，六个站点都亮着，插画仍然讲得清楚。
 * - once：只走一趟，停在终点（开场动画第 2 幕）；
 * - loop：循环走（登录页桌面插画），回到起点时整幅淡出淡入，看不到“瞬移”。
 */
import PgMascot from '@/components/ui/PgMascot.vue'
import { PATH_STEP_NAMES } from '@/copy/onboarding'

withDefaults(defineProps<{ mode?: 'once' | 'loop'; labels?: boolean }>(), { mode: 'once', labels: true })

/** 站点位置（占舞台宽高的百分比）。 */
const NODES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 11, y: 76 },
  { x: 29, y: 48 },
  { x: 48, y: 72 },
  { x: 64, y: 42 },
  { x: 79, y: 68 },
  { x: 89, y: 26 },
]
const PATH_D = 'M11 76 C 14 56, 20 48, 29 48 S 41 72, 48 72 S 58 42, 64 42 S 75 68, 79 68 S 87 40, 89 26'
</script>

<template>
  <view class="pgp" :class="'pgp--' + mode" role="img" aria-label="六个站点依次点亮，小方走到终点">
    <view class="pgp__stage">
      <svg class="pgp__svg" viewBox="0 0 100 86" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path :d="PATH_D" class="pgp__road-bed" />
        <path :d="PATH_D" class="pgp__road" />
      </svg>
      <view
        v-for="(node, i) in NODES"
        :key="i"
        class="pgp__node"
        :class="'pgp__node--' + (i + 1)"
        :style="{ left: node.x + '%', top: node.y + '%' }"
      >
        <text class="pgp__num">{{ i + 1 }}</text>
        <text v-if="labels" class="pgp__label">{{ PATH_STEP_NAMES[i] }}</text>
      </view>
      <view class="pgp__walker">
        <view class="pgp__bob">
          <PgMascot expr="happy" :size="96" />
        </view>
      </view>
    </view>
  </view>
</template>

<!-- 带 pgp- 前缀的非 scoped 样式：需要对 html[data-motion] 做选择，也要穿过 PgMascot 的 v-html。 -->
<style>
.pgp { width: 100%; max-width: 380px; margin: 0 auto; }
.pgp__stage { position: relative; width: 100%; aspect-ratio: 100 / 86; }
.pgp__svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.pgp__road-bed { fill: none; stroke: var(--rule); stroke-width: 18px; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.pgp__road { fill: none; stroke: var(--rule-2); stroke-width: 3px; stroke-linecap: round; stroke-dasharray: 2 9; vector-effect: non-scaling-stroke; }

.pgp__node {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transform: translate(-50%, -50%);
  width: 0;
  height: 0;
  overflow: visible;
}
.pgp__num {
  position: absolute;
  left: 50%;
  top: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  border: var(--bw) solid var(--rule-2);
  border-radius: 50%;
  background: var(--sheet);
  box-shadow: 0 3px 0 var(--rule-2);
  color: var(--ink-2);
  font-size: var(--fs-13);
  font-weight: var(--fw-black);
}
.pgp__label {
  position: absolute;
  left: 50%;
  top: 24px;
  transform: translateX(-50%);
  white-space: nowrap;
  color: var(--ink-2);
  font-size: var(--fs-12);
  font-weight: var(--fw-black);
}

.pgp__walker {
  position: absolute;
  width: 25%;
  left: 11%;
  top: 76%;
  transform: translate(-50%, -88%);
  pointer-events: none;
}
.pgp__bob .pg-mascot { display: block; width: 100%; }
.pgp__bob .pg-mascot svg { display: block; width: 100%; height: auto; }

/* 一趟的时长；循环版多留一段停在终点的时间 */
.pgp--once { --pgp-dur: 7.2s; }
.pgp--loop { --pgp-dur: 12s; }

.pgp__walker { animation: pgp-walk var(--pgp-dur) linear both; }
.pgp__bob { animation: pgp-bob var(--pgp-dur) ease-in-out both; transform-origin: 50% 100%; }
.pgp__node--1 .pgp__num { animation: pgp-lit-1 var(--pgp-dur) linear both; }
.pgp__node--2 .pgp__num { animation: pgp-lit-2 var(--pgp-dur) linear both; }
.pgp__node--3 .pgp__num { animation: pgp-lit-3 var(--pgp-dur) linear both; }
.pgp__node--4 .pgp__num { animation: pgp-lit-4 var(--pgp-dur) linear both; }
.pgp__node--5 .pgp__num { animation: pgp-lit-5 var(--pgp-dur) linear both; }
.pgp__node--6 .pgp__num { animation: pgp-lit-6 var(--pgp-dur) linear both; }
.pgp--loop .pgp__walker,
.pgp--loop .pgp__bob,
.pgp--loop .pgp__num { animation-iteration-count: infinite; }
.pgp--loop .pgp__stage { animation: pgp-cycle var(--pgp-dur) linear infinite; }

/* 站点 → 小方站的位置（和 NODES 保持一致）：4/17/30/43/56/69% 到达 1…6 号站 */
@keyframes pgp-walk {
  0%, 4% { left: 11%; top: 76%; animation-timing-function: ease-in-out; }
  17% { left: 29%; top: 48%; animation-timing-function: ease-in-out; }
  30% { left: 48%; top: 72%; animation-timing-function: ease-in-out; }
  43% { left: 64%; top: 42%; animation-timing-function: ease-in-out; }
  56% { left: 79%; top: 68%; animation-timing-function: ease-in-out; }
  69%, 100% { left: 89%; top: 26%; }
}
@keyframes pgp-bob {
  0%, 4% { transform: translateY(0); }
  10.5% { transform: translateY(-14%); }
  17% { transform: translateY(0); }
  23.5% { transform: translateY(-14%); }
  30% { transform: translateY(0); }
  36.5% { transform: translateY(-14%); }
  43% { transform: translateY(0); }
  49.5% { transform: translateY(-14%); }
  56% { transform: translateY(0); }
  62.5% { transform: translateY(-14%); }
  69% { transform: translateY(0); }
  74% { transform: translateY(-12%) scale(1.04, 0.98); }
  79% { transform: translateY(0) scale(1.05, 0.93); }
  84%, 100% { transform: translateY(0); }
}
@keyframes pgp-lit-1 { 0%, 3.9% { background: var(--sheet); border-color: var(--rule-2); box-shadow: 0 3px 0 var(--rule-2); color: var(--ink-2); transform: scale(1); } 4% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1.25); } 8%, 100% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1); } }
@keyframes pgp-lit-2 { 0%, 16.9% { background: var(--sheet); border-color: var(--rule-2); box-shadow: 0 3px 0 var(--rule-2); color: var(--ink-2); transform: scale(1); } 17% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1.25); } 21%, 100% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1); } }
@keyframes pgp-lit-3 { 0%, 29.9% { background: var(--sheet); border-color: var(--rule-2); box-shadow: 0 3px 0 var(--rule-2); color: var(--ink-2); transform: scale(1); } 30% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1.25); } 34%, 100% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1); } }
@keyframes pgp-lit-4 { 0%, 42.9% { background: var(--sheet); border-color: var(--rule-2); box-shadow: 0 3px 0 var(--rule-2); color: var(--ink-2); transform: scale(1); } 43% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1.25); } 47%, 100% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1); } }
@keyframes pgp-lit-5 { 0%, 55.9% { background: var(--sheet); border-color: var(--rule-2); box-shadow: 0 3px 0 var(--rule-2); color: var(--ink-2); transform: scale(1); } 56% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1.25); } 60%, 100% { background: var(--accent); border-color: var(--accent-lip); box-shadow: 0 3px 0 var(--accent-lip); color: var(--on-accent); transform: scale(1); } }
@keyframes pgp-lit-6 { 0%, 68.9% { background: var(--sheet); border-color: var(--rule-2); box-shadow: 0 3px 0 var(--rule-2); color: var(--ink-2); transform: scale(1); } 69% { background: var(--bee); border-color: var(--bee-lip); box-shadow: 0 3px 0 var(--bee-lip); color: var(--on-bee); transform: scale(1.35); } 74%, 100% { background: var(--bee); border-color: var(--bee-lip); box-shadow: 0 3px 0 var(--bee-lip); color: var(--on-bee); transform: scale(1); } }
/* 循环版：回到起点前整幅淡出，再淡入 */
@keyframes pgp-cycle {
  0% { opacity: 0; }
  3% { opacity: 1; }
  92% { opacity: 1; }
  98%, 100% { opacity: 0; }
}

/* 减少动态效果 / 动效关闭：循环版不淡出，直接停在最后一帧 */
@media (prefers-reduced-motion: reduce) {
  .pgp--loop .pgp__stage { animation: none; opacity: 1; }
}
html[data-motion='off'] .pgp--loop .pgp__stage { animation: none; opacity: 1; }
</style>
