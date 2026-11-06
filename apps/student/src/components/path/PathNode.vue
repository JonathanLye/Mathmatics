<script setup lang="ts">
/**
 * 路径上的一个节点：完成=金色对勾；当前=青绿、脉动、“继续”气泡；开始了=进度环；软锁=灰色带锁（点开可以确认跳过去）。
 * 外层 0×0 定位在路径点上，里面的东西都相对这个点摆，缩放只影响位置，不影响按钮大小。
 */
import { computed } from 'vue'
import MathText from '@ui-math/MathText.vue'
import PgButton from '@/components/ui/PgButton.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import ProgressRing from '@/components/ProgressRing.vue'
import TagChip from '@/components/TagChip.vue'
import { AI_IMPORTED_TAG, PATH_COPY, STATUS_LABEL } from '@/copy'
import type { PathItem } from '@/types/path'
import { layerFraction, nodeAction, type NodeVisual } from './pathLogic'

const props = defineProps<{
  item: PathItem
  visual: NodeVisual
  index: number
  side: 'left' | 'right'
  /** 这次回来时刚完成：盖章动画。 */
  just: boolean
  /** 小方还在走过来：气泡稍后才出来。 */
  settled: boolean
  /** 当前节点的标题由小方说，不重复。 */
  hideLabel: boolean
}>()
defineEmits<{ (e: 'open'): void; (e: 'continue'): void }>()

const variant = computed(() => (props.visual === 'done' ? 'hint' : 'primary'))
const ring = computed(() => layerFraction(props.item))
const showRing = computed(() => props.item.state === 'active' && ring.value > 0)
const actionText = computed(() => PATH_COPY.action[nodeAction(props.item)])
const plainTitle = computed(() => props.item.title.replace(/\$/g, ''))
const ariaLabel = computed(() => `第 ${props.index + 1} 道：${plainTitle.value}，${props.visual === 'locked' ? '还没解锁' : STATUS_LABEL[props.item.state]}`)
</script>

<template>
  <view class="pg-node" :class="['pg-node--' + visual, 'pg-node--' + side, { 'pg-node--just': just }]" :style="{ '--i': index }" role="listitem">
    <view class="pg-node__inner">
      <view v-if="visual === 'current' && settled" class="pg-node__bubble">
        <PgButton class="pg-node__bubblebtn" variant="secondary" size="sm" sound="tap" data-testid="home-continue" :aria-label="actionText + ' ' + plainTitle" @tap="$emit('continue')">
          {{ actionText }}
        </PgButton>
      </view>
      <view v-if="visual === 'current'" class="pg-node__pulse" aria-hidden="true" />
      <view v-if="just" class="pg-node__burst" aria-hidden="true" />
      <ProgressRing v-if="showRing" class="pg-node__ring" :value="ring" :size="104" :stroke="8" />
      <PgButton
        class="pg-node__face"
        :variant="variant"
        size="icon"
        sound="tap"
        data-testid="home-path-node"
        :data-problem-id="item.problemId"
        :data-state="item.state"
        :data-visual="visual"
        :data-current="visual === 'current' ? 'true' : undefined"
        :aria-label="ariaLabel"
        @tap="$emit('open')"
      >
        <PgIcon v-if="visual === 'done'" name="check" :size="38" />
        <PgIcon v-else-if="visual === 'locked'" name="lock" :size="28" />
        <PgIcon v-else name="pen" :size="visual === 'current' ? 40 : 34" />
      </PgButton>
      <view v-if="!hideLabel" class="pg-node__label">
        <MathText class="pg-node__title" :text="item.title" />
        <TagChip v-if="item.autoImported" class="pg-node__tag">{{ AI_IMPORTED_TAG }}</TagChip>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-node { position: absolute; width: 0; height: 0; --_size: 72px; }
.pg-node--current { --_size: 84px; z-index: 2; }
.pg-node__inner { position: absolute; left: 0; top: 0; width: 0; height: 0; }

.pg-node__face.pg-button {
  position: absolute;
  left: calc(var(--_size) / -2);
  top: calc(var(--_size) / -2);
  width: var(--_size);
  height: var(--_size);
  min-width: var(--_size);
  min-height: var(--_size);
  margin: 0;
  padding: 0;
  border-radius: 50%;
  box-shadow: 0 7px 0 var(--_lip);
}
.pg-node__face.pg-button::before {
  content: '';
  position: absolute;
  left: 20%;
  top: 9%;
  width: 34%;
  height: 12%;
  border-radius: var(--radius-pill);
  background: var(--shine);
  transform: rotate(-16deg);
}
.pg-node__face.pg-button:active:not([disabled]) { transform: translateY(5px); box-shadow: 0 2px 0 var(--_lip); }

/* 软锁：灰色，但还是能点 */
.pg-node--locked .pg-node__face.pg-button { --_face: var(--rule); --_ink: var(--ink-2); --_lip: var(--rule-2); }
.pg-node--locked .pg-node__face.pg-button::before { opacity: 0.6; }

/* 当前节点：一圈软边 + 向外扩散的脉动 */
.pg-node--current .pg-node__face.pg-button { box-shadow: 0 7px 0 var(--_lip), 0 3px 0 10px var(--accent-soft); }
.pg-node--current .pg-node__face.pg-button:active:not([disabled]) { box-shadow: 0 2px 0 var(--_lip), 0 -2px 0 10px var(--accent-soft); }
.pg-node__pulse {
  position: absolute;
  left: -52px;
  top: -49px;
  width: 104px;
  height: 104px;
  border: var(--bw) solid var(--accent);
  border-radius: 50%;
  opacity: 0;
  animation: pg-node-pulse 2200ms var(--ease-out) infinite;
}
@keyframes pg-node-pulse {
  0% { transform: scale(0.82); opacity: 0.7; }
  70%, 100% { transform: scale(1.28); opacity: 0; }
}

.pg-node__ring { position: absolute; left: -52px; top: -49px; }
.pg-node--active { --_size: 76px; }
.pg-node--active .pg-node__ring { left: -48px; top: -45px; transform: scale(0.92); }

/* 气泡：小尾巴指向节点，轻轻上下动 */
.pg-node__bubble {
  position: absolute;
  left: 0;
  top: calc(var(--_size) / -2 - 66px);
  width: 0;
  display: flex;
  justify-content: center;
  animation: pg-node-bob 1800ms ease-in-out infinite;
}
.pg-node__bubblebtn.pg-button {
  flex: none;
  min-height: 44px;
  padding: 0 var(--sp-5);
  border-radius: var(--radius-16);
  color: var(--accent-text);
  font-size: var(--fs-15);
  letter-spacing: 1px;
  white-space: nowrap;
}
.pg-node__bubblebtn.pg-button::before {
  content: '';
  position: absolute;
  left: 50%;
  bottom: -11px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  background: var(--sheet);
  border-right: var(--bw) solid var(--rule-2);
  border-bottom: var(--bw) solid var(--rule-2);
  transform: rotate(45deg);
}
@keyframes pg-node-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

/* 标题放在节点的空的一侧 */
.pg-node__label {
  position: absolute;
  top: -24px;
  width: 104px;
  width: min(120px, 30cqw);
  min-height: 48px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 2px;
}
.pg-node--right .pg-node__label { left: calc(var(--_size) / 2 + 12px); }
.pg-node--left .pg-node__label { right: calc(var(--_size) / 2 + 12px); align-items: flex-end; text-align: right; }
.pg-node__title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--ink-2);
  font-size: var(--fs-13);
  font-weight: var(--fw-heavy);
  line-height: 1.35;
}
.pg-node--active .pg-node__title { color: var(--ink); }
.pg-node__tag { margin-top: 2px; }

/* 入场：错峰弹出 */
.pg-pathmap--enter .pg-node__inner { animation: pg-node-in var(--dur-slow) var(--ease-spring) both; animation-delay: calc(var(--i) * 50ms); }
@keyframes pg-node-in {
  from { transform: scale(0.4); opacity: 0; }
  to { transform: none; opacity: 1; }
}

/* 刚完成：像盖章一样落下，外加一圈金色冲击波 */
.pg-node--just .pg-node__face.pg-button { animation: pg-node-stamp 620ms var(--ease-out) both; }
.pg-node__burst {
  position: absolute;
  left: -52px;
  top: -49px;
  width: 104px;
  height: 104px;
  border: 6px solid var(--bee);
  border-radius: 50%;
  opacity: 0;
  animation: pg-node-burst 760ms 120ms var(--ease-out) both;
}
@keyframes pg-node-stamp {
  0% { transform: scale(1.45); opacity: 0; }
  55% { transform: scale(0.9); opacity: 1; }
  78% { transform: scale(1.06); }
  100% { transform: none; }
}
@keyframes pg-node-burst {
  0% { transform: scale(0.7); opacity: 0.9; }
  100% { transform: scale(1.5); opacity: 0; }
}
</style>
