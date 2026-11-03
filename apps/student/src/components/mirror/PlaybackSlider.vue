<script setup lang="ts">
/**
 * 回放时间轴滑块（issue #43 A 侧子集；04 §5.2）。
 *
 * - 0..durationMs 拖动/键盘定位；播放/暂停；时间轴标记（层切换/提交/提示/批注/离开/识别，颜色按语义）；
 * - 当前事件标签：显示当前位置之前（含）最近一个标记；
 * - a11y：role="slider" + aria-valuemin/max/now/valuetext；键盘 ←/→ 步进、空格/Enter 播放暂停、Home/End 两端；
 * - 触控：轨道热区 44px（02 §2.4）；颜色只用 tokens.css 变量（02 §2.2）；
 * - 播放用 requestAnimationFrame（不可用时退化为不动），暂停/卸载/父级 playing=false 时清理；
 * - 组件本轮不接线（build 不打包），后续由教师端 #51/C 接入，配合 packages/engine 的 replay(events, uptoSeq)。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { clamp, formatTime, markerPercent, markerTone, seekIndex } from './mirror'
import type { MirrorTimeline } from './mirror'

const props = withDefaults(
  defineProps<{
    /** buildTimeline(events) 的结果（04 §5.2） */
    timeline?: MirrorTimeline
    /** 当前回放时间（毫秒，v-model） */
    modelValue?: number
    /** 播放状态（v-model:playing；不绑定则组件内部维护） */
    playing?: boolean
    disabled?: boolean
  }>(),
  {
    timeline: () => ({ durationMs: 0, markers: [] }),
    modelValue: 0,
    playing: false,
    disabled: false,
  },
)
const emit = defineEmits<{
  (e: 'update:modelValue', ms: number): void
  (e: 'update:playing', playing: boolean): void
  (e: 'seek', ms: number): void
}>()

const duration = computed(() => Math.max(0, props.timeline?.durationMs ?? 0))
const markers = computed(() => props.timeline?.markers ?? [])
const position = ref(clamp(props.modelValue ?? 0, 0, duration.value))
const playing = ref(Boolean(props.playing))

/** 键盘步进：约 1% 时长，最少 1 秒。 */
const stepMs = computed(() => Math.max(1000, Math.round(duration.value / 100 / 1000) * 1000))
/** 播放时 emit update:modelValue 的节流（约 5 次/秒，够驱动镜像页重渲染又不刷爆父级）。 */
const EMIT_INTERVAL_MS = 200

let rafId: number | null = null
let lastFrameTs = 0
let lastEmitTs = 0
let dragRect: { left: number; width: number } | null = null
let dragListeners: { move: (event: PointerEvent) => void; up: () => void } | null = null

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

function emitPosition(force = false) {
  const ts = now()
  if (!force && ts - lastEmitTs < EMIT_INTERVAL_MS) return
  lastEmitTs = ts
  emit('update:modelValue', position.value)
}

function requestFrame(callback: (timestamp: number) => void): number | null {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return null
}

function cancelFrame(id: number | null) {
  if (id !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
}

function tick(timestamp: number) {
  rafId = null
  if (!playing.value) return
  if (lastFrameTs === 0) lastFrameTs = timestamp
  const delta = Math.max(0, timestamp - lastFrameTs)
  lastFrameTs = timestamp
  const next = position.value + delta
  if (next >= duration.value) {
    position.value = duration.value
    emitPosition(true)
    stopPlayback()
    return
  }
  position.value = next
  emitPosition()
  rafId = requestFrame(tick)
}

function startPlayback() {
  if (props.disabled || duration.value <= 0 || playing.value) return
  if (position.value >= duration.value) {
    position.value = 0
    emitPosition(true)
  }
  playing.value = true
  emit('update:playing', true)
  lastFrameTs = 0
  lastEmitTs = 0
  rafId = requestFrame(tick)
}

function stopPlayback() {
  cancelFrame(rafId)
  rafId = null
  if (!playing.value) return
  playing.value = false
  emit('update:playing', false)
  emitPosition(true)
}

function play() {
  if (props.disabled) return
  startPlayback()
}

function pause() {
  stopPlayback()
}

function toggle() {
  if (props.disabled || duration.value <= 0) return
  if (playing.value) pause()
  else play()
}

function seekTo(ms: number) {
  const next = clamp(ms, 0, duration.value)
  position.value = next
  emit('update:modelValue', next)
  emit('seek', next)
}

function jumpToMarker(atMs: number) {
  if (props.disabled) return
  pause()
  seekTo(atMs)
}

function timeFromClientX(clientX: number): number {
  if (!dragRect || dragRect.width <= 0) return position.value
  return clamp(((clientX - dragRect.left) / dragRect.width) * duration.value, 0, duration.value)
}

function endDrag() {
  if (typeof window !== 'undefined' && dragListeners) {
    window.removeEventListener('pointermove', dragListeners.move)
    window.removeEventListener('pointerup', dragListeners.up)
    window.removeEventListener('pointercancel', dragListeners.up)
  }
  dragListeners = null
  dragRect = null
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled || duration.value <= 0) return
  const target = event.currentTarget as HTMLElement | null
  if (!target || typeof target.getBoundingClientRect !== 'function') return
  const rect = target.getBoundingClientRect()
  dragRect = { left: rect.left, width: rect.width }
  pause()
  seekTo(timeFromClientX(event.clientX))
  if (typeof window === 'undefined') return
  const move = (moveEvent: PointerEvent) => {
    if (!dragRect) return
    seekTo(timeFromClientX(moveEvent.clientX))
  }
  const up = () => endDrag()
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
  dragListeners = { move, up }
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  const key = event.key
  if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
    event.preventDefault()
    toggle()
    return
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    event.preventDefault()
    pause()
    seekTo(position.value + (key === 'ArrowRight' ? stepMs.value : -stepMs.value))
    return
  }
  if (key === 'Home') {
    event.preventDefault()
    pause()
    seekTo(0)
  } else if (key === 'End') {
    event.preventDefault()
    pause()
    seekTo(duration.value)
  }
}

watch(
  () => props.modelValue,
  (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    const next = clamp(value, 0, duration.value)
    // 播放中的写回来自本组件节流 emit，不反向打断；外部跳转（>1ms）才同步。
    if (Math.abs(next - position.value) > 1) position.value = next
  },
)
watch(duration, (value) => {
  position.value = clamp(position.value, 0, value)
})
watch(
  () => props.playing,
  (value) => {
    if (Boolean(value) === playing.value) return
    if (value) startPlayback()
    else stopPlayback()
  },
)

onUnmounted(() => {
  cancelFrame(rafId)
  rafId = null
  if (typeof window !== 'undefined' && dragListeners) {
    window.removeEventListener('pointermove', dragListeners.move)
    window.removeEventListener('pointerup', dragListeners.up)
    window.removeEventListener('pointercancel', dragListeners.up)
    dragListeners = null
  }
})

const progressPercent = computed(() => markerPercent(position.value, duration.value))
const currentMarker = computed(() => {
  const index = seekIndex(markers.value, position.value)
  return index >= 0 ? markers.value[index] : null
})
const currentLabel = computed(() => {
  const marker = currentMarker.value
  if (!marker) return markers.value.length > 0 ? '开始' : '没有可回放的事件'
  return formatTime(marker.at) + ' · ' + marker.label
})
const valueText = computed(() => formatTime(position.value) + ' / ' + formatTime(duration.value))
const isEmpty = computed(() => duration.value <= 0)
</script>

<template>
  <view class="pg-playback" :class="{ 'pg-playback--disabled': props.disabled || isEmpty }" data-testid="playback-slider">
    <view class="pg-playback__bar">
      <button
        class="pg-playback__toggle"
        data-testid="playback-toggle"
        :disabled="props.disabled || isEmpty"
        :aria-label="playing ? '暂停回放' : '播放回放'"
        @tap="toggle"
      >
        <text class="pg-playback__icon">{{ playing ? '⏸' : '▶' }}</text>
      </button>
      <text class="pg-playback__time pg-mono">{{ valueText }}</text>
      <text class="pg-playback__label pg-small" data-testid="playback-label">{{ currentLabel }}</text>
    </view>

    <view
      class="pg-playback__track"
      role="slider"
      tabindex="0"
      :aria-label="'回放进度'"
      :aria-valuemin="0"
      :aria-valuemax="duration"
      :aria-valuenow="Math.round(position)"
      :aria-valuetext="valueText"
      :aria-disabled="props.disabled || isEmpty ? 'true' : 'false'"
      data-testid="playback-track"
      @pointerdown="onPointerDown"
      @keydown="onKeydown"
    >
      <view class="pg-playback__rail" />
      <view class="pg-playback__fill" :style="{ width: progressPercent + '%' }" />
      <view
        v-for="marker in markers"
        :key="marker.seq"
        class="pg-playback__marker"
        :class="'pg-playback__marker--' + markerTone(marker.type)"
        :style="{ left: markerPercent(marker.at, duration) + '%' }"
        :title="marker.label"
        data-testid="playback-marker"
        :data-marker-type="marker.type"
        @pointerdown.stop="jumpToMarker(marker.at)"
      />
      <view class="pg-playback__thumb" :style="{ left: progressPercent + '%' }" />
    </view>

    <text v-if="isEmpty" class="pg-playback__empty pg-small" data-testid="playback-empty">没有可回放的事件（时间轴为空）。</text>
  </view>
</template>

<style scoped>
.pg-playback {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
}

.pg-playback--disabled {
  opacity: 0.6;
}

.pg-playback__bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

/* 触控目标 ≥ 44px（02 §2.4）。 */
.pg-playback__toggle {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: var(--sheet);
  color: var(--accent);
}

.pg-playback__toggle::after {
  border: 0;
}

.pg-playback__toggle:disabled {
  opacity: 0.45;
}

.pg-playback__icon {
  font-size: 16px;
  line-height: 1;
}

.pg-playback__time {
  flex: 0 0 auto;
  font-size: var(--fs-mono);
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
}

.pg-playback__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
}

/* 轨道热区 44px 高，视觉轨道 6px；拖动/键盘都落在这块热区上。 */
.pg-playback__track {
  position: relative;
  height: 44px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}

.pg-playback__track:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: var(--radius-input);
}

.pg-playback__rail,
.pg-playback__fill {
  position: absolute;
  top: 50%;
  height: 6px;
  border-radius: 3px;
  transform: translateY(-50%);
}

.pg-playback__rail {
  left: 0;
  right: 0;
  background: var(--rule);
}

.pg-playback__fill {
  left: 0;
  background: var(--accent);
}

/* 事件标记：短竖条，颜色按 markerTone 语义（02 §2.2）。 */
.pg-playback__marker {
  position: absolute;
  top: 50%;
  width: 4px;
  height: 16px;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  background: var(--ink-2);
}

.pg-playback__marker--accent {
  background: var(--accent);
}

.pg-playback__marker--ok {
  background: var(--ok);
}

.pg-playback__marker--hint {
  background: var(--hint);
}

.pg-playback__marker--margin {
  background: var(--margin);
}

.pg-playback__marker--muted {
  background: var(--ink-2);
}

.pg-playback__thumb {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--sheet);
  border: 2px solid var(--accent);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.pg-playback__empty {
  color: var(--ink-2);
}
</style>
