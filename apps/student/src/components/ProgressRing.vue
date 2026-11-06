<script setup lang="ts">
/** 圆环进度：今日目标、路径节点的做到第几层。value 是 0–1，变化时滑过去。中间内容走插槽。 */
import { computed } from 'vue'
import { clampProgress } from '@/components/ui/uiLogic'

const props = withDefaults(defineProps<{ value: number; size?: number; stroke?: number; tone?: 'accent' | 'bee' | 'fox' }>(), {
  size: 48,
  stroke: 6,
  tone: 'accent',
})

const radius = computed(() => (props.size - props.stroke) / 2)
const center = computed(() => props.size / 2)
const offset = computed(() => 100 - clampProgress(props.value) * 100)
</script>

<template>
  <view class="pg-ring" :class="'pg-ring--' + tone" :style="{ width: size + 'px', height: size + 'px' }">
    <svg class="pg-ring__svg" :width="size" :height="size" :viewBox="'0 0 ' + size + ' ' + size" aria-hidden="true" focusable="false">
      <circle class="pg-ring__track" :cx="center" :cy="center" :r="radius" :stroke-width="stroke" fill="none" />
      <circle
        class="pg-ring__fill"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="stroke"
        fill="none"
        pathLength="100"
        stroke-dasharray="100"
        :stroke-dashoffset="offset"
      />
    </svg>
    <view class="pg-ring__body"><slot /></view>
  </view>
</template>

<style scoped>
.pg-ring { position: relative; display: inline-flex; flex: none; }
.pg-ring__svg { display: block; transform: rotate(-90deg); }
.pg-ring__track { stroke: var(--rule); }
.pg-ring__fill { stroke-linecap: round; transition: stroke-dashoffset var(--dur-slow) var(--ease-out); }
.pg-ring--accent .pg-ring__fill { stroke: var(--accent); }
.pg-ring--bee .pg-ring__fill { stroke: var(--bee); }
.pg-ring--fox .pg-ring__fill { stroke: var(--fox); }
.pg-ring__body { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
</style>
