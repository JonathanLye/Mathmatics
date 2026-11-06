<script setup lang="ts">
/**
 * 蜿蜒的路径：一条有厚度的路（SVG）连起所有节点，走过的路段是金色。终点是单元复习的宝箱。
 * 小方站在当前节点旁边，从路径上刚完成的那一道跳过来。
 * 整张图按 340 宽的逻辑画布等比缩放，纯 CSS，首帧就是对的。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { PATH_COPY } from '@/copy'
import { feedbackAllowed } from '@/motion/useFeedbackPrefs'
import { playSfx } from '@/motion/sfx'
import { MASCOT_MOTION } from '@/motion/useMascot'
import type { PathItem } from '@/types/path'
import PathChest from './PathChest.vue'
import PathNode from './PathNode.vue'
import { PATH_TOP, PATH_TOP_ROOMY, PATH_WIDTH, currentIndex, freeSide, labelHidden, nodeVisual, pathHeight, pathPoints, pointStyle, segmentPath } from './pathLogic'

const props = withDefaults(
  defineProps<{
    items: readonly PathItem[]
    /** 这次回来时刚完成的题：盖章、金色路段画过去、小方跳到下一个。 */
    justDone?: readonly string[]
    /** 这个单元一道都没动过、也是课程的第一个单元：小方说“从这里开始”。 */
    firstTime?: boolean
    /** 节点错峰弹出（进入页面、换单元时）。 */
    enter?: boolean
  }>(),
  { justDone: () => [], firstTime: false, enter: false },
)
defineEmits<{ (e: 'open', item: PathItem): void; (e: 'continue', item: PathItem): void; (e: 'chest'): void }>()

const current = computed(() => currentIndex(props.items))
const top = computed(() => (current.value === 0 ? PATH_TOP_ROOMY : PATH_TOP))
const points = computed(() => pathPoints(props.items.length + 1, top.value))
const height = computed(() => pathHeight(points.value.length, top.value))
const sides = computed(() => points.value.map(freeSide))
const unitDone = computed(() => props.items.length > 0 && props.items.every((item) => item.state === 'done'))
const chestPoint = computed(() => points.value[points.value.length - 1])

const segments = computed(() =>
  props.items.map((item, i) => ({
    id: item.problemId,
    d: segmentPath(points.value[i], points.value[i + 1]),
    done: item.state === 'done',
    just: props.justDone.includes(item.problemId),
  })),
)

/** 小方站的位置：当前节点；单元做完了站在宝箱旁。动画时先站在刚完成的节点，过一会儿跳过去。 */
const restIndex = computed(() => (current.value === -1 ? points.value.length - 1 : current.value))
const mascotIndex = ref(restIndex.value)
const hopping = ref(false)
const settled = ref(true)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

function settle(): void {
  clearTimer()
  mascotIndex.value = restIndex.value
  hopping.value = false
  settled.value = true
}

watch(
  () => [restIndex.value, props.justDone.join(',')] as const,
  () => {
    clearTimer()
    const first = props.items.findIndex((item) => props.justDone.includes(item.problemId))
    if (first === -1 || !feedbackAllowed('motion')) {
      settle()
      return
    }
    // 先站在刚完成的节点上，等盖章和金色路段画完再跳到下一个。
    mascotIndex.value = first
    settled.value = false
    hopping.value = false
    playSfx('layer-up')
    timer = setTimeout(() => {
      hopping.value = true
      mascotIndex.value = restIndex.value
      playSfx('correct')
      timer = setTimeout(settle, 760)
    }, 820)
  },
  { immediate: true },
)
onBeforeUnmount(clearTimer)

const mascotPoint = computed(() => points.value[Math.min(mascotIndex.value, points.value.length - 1)])
const mascotSide = computed(() => sides.value[restIndex.value])
const mascotStyle = computed(() => pointStyle(mascotPoint.value, height.value))
const mascotExpr = computed(() => (unitDone.value ? 'cheer' : hopping.value ? 'happy' : 'idle'))
const mascotMotion = computed(() => {
  if (hopping.value) return MASCOT_MOTION.happy
  return unitDone.value ? ['hop' as const] : MASCOT_MOTION.idle
})
const mascotSay = computed(() => {
  if (!settled.value) return ''
  if (unitDone.value) return PATH_COPY.mascotCleared
  const item = props.items[current.value]
  if (!item) return ''
  const title = item.title.replace(/\$/g, '')
  if (item.state === 'active') return PATH_COPY.mascotHere(title)
  return props.firstTime ? PATH_COPY.mascotFirst : PATH_COPY.mascotNext(title)
})
</script>

<template>
  <view class="pg-pathmap" :class="{ 'pg-pathmap--enter': enter }" :style="{ aspectRatio: PATH_WIDTH + ' / ' + height }" data-testid="home-path" role="list">
    <svg class="pg-pathmap__road" :viewBox="'0 0 ' + PATH_WIDTH + ' ' + height" aria-hidden="true" focusable="false">
      <g class="pg-pathmap__lip">
        <path v-for="seg in segments" :key="'l' + seg.id" :d="seg.d" />
      </g>
      <g class="pg-pathmap__face">
        <path v-for="seg in segments" :key="'f' + seg.id" :d="seg.d" />
      </g>
      <g class="pg-pathmap__dash">
        <path v-for="seg in segments" :key="'p' + seg.id" :d="seg.d" />
      </g>
      <g class="pg-pathmap__lip pg-pathmap__lip--done">
        <path v-for="seg in segments.filter((s) => s.done)" :key="'dl' + seg.id" :d="seg.d" pathLength="1" :class="{ 'pg-pathmap__draw': seg.just }" />
      </g>
      <g class="pg-pathmap__face pg-pathmap__face--done">
        <path v-for="seg in segments.filter((s) => s.done)" :key="'df' + seg.id" :d="seg.d" pathLength="1" :class="{ 'pg-pathmap__draw': seg.just }" />
      </g>
    </svg>

    <PathNode
      v-for="(item, i) in items"
      :key="item.problemId"
      :style="pointStyle(points[i], height)"
      :item="item"
      :index="i"
      :visual="nodeVisual(item, i === current)"
      :side="sides[i]"
      :just="justDone.includes(item.problemId)"
      :settled="settled"
      :hide-label="labelHidden(i, current, sides)"
      @open="$emit('open', item)"
      @continue="$emit('continue', item)"
    />

    <PathChest :style="pointStyle(chestPoint, height)" :done="unitDone" :index="items.length" @open="$emit('chest')" />

    <view class="pg-pathmap__mascot" :class="['pg-pathmap__mascot--' + mascotSide, { 'pg-pathmap__mascot--done': unitDone }]" :style="mascotStyle" data-testid="home-mascot" aria-hidden="true">
      <view class="pg-pathmap__figure">
        <view v-if="mascotSay" class="pg-pathmap__say">{{ mascotSay }}</view>
        <PgMascot :expr="mascotExpr" :motion="mascotMotion" :size="76" />
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-pathmap {
  position: relative;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  container-type: inline-size;
}
.pg-pathmap__road { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.pg-pathmap__road path { fill: none; stroke-linecap: round; }

/* 路有厚度：下面一层错开 5 个单位当路肩 */
.pg-pathmap__lip path { stroke: var(--rule-2); stroke-width: 16; transform: translateY(5px); }
.pg-pathmap__face path { stroke: var(--rule); stroke-width: 16; }
.pg-pathmap__dash path { stroke: var(--paper); stroke-width: 3; stroke-dasharray: 1 13; }
.pg-pathmap__lip--done path { stroke: var(--bee-lip); }
.pg-pathmap__face--done path { stroke: var(--bee); }

/* 刚完成的路段：金色从这一头画到下一头 */
.pg-pathmap__draw { stroke-dasharray: 1; animation: pg-path-draw 720ms 260ms var(--ease-out) both; }
@keyframes pg-path-draw {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}

/* 小方：站在当前节点空的一侧；换节点时跳过去 */
.pg-pathmap__mascot {
  position: absolute;
  z-index: 3;
  width: 0;
  height: 0;
  pointer-events: none;
  transition: left 640ms var(--ease-spring), top 640ms var(--ease-spring);
}
.pg-pathmap__figure {
  position: absolute;
  top: -24px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: 110px;
  width: min(148px, calc(50cqw - 62px));
}
.pg-pathmap__mascot--right .pg-pathmap__figure { left: 58px; align-items: flex-start; }
.pg-pathmap__mascot--left .pg-pathmap__figure { right: 58px; align-items: flex-end; }
.pg-pathmap__say {
  position: absolute;
  bottom: calc(100% + 8px);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  border: var(--bw) solid var(--rule);
  border-radius: var(--radius-16);
  background: var(--sheet);
  color: var(--ink);
  font-size: var(--fs-13);
  font-weight: var(--fw-heavy);
  line-height: 1.35;
  animation: pg-path-say var(--dur-slow) var(--ease-spring) both;
}
.pg-pathmap__mascot--right .pg-pathmap__say { left: 0; border-bottom-left-radius: 4px; }
.pg-pathmap__mascot--left .pg-pathmap__say { right: 0; border-bottom-right-radius: 4px; }
@keyframes pg-path-say {
  from { transform: translateY(8px) scale(0.92); opacity: 0; }
  to { transform: none; opacity: 1; }
}
</style>
