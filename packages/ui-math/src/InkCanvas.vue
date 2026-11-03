<script setup lang="ts">
/**
 * ink-v1 手写画布（issue #14）。
 *
 * 分工：
 * - 数据/平滑/撤销/橡皮/划掉删除/序列化/重放全部在 ./ink.ts 纯逻辑里（不依赖 DOM）；
 * - 本组件只负责：H5 事件采集（Pointer Events + pointer capture + getCoalescedEvents）、
 *   canvas 2D 绘制（双画布：底图 + 当前笔，每帧只重绘当前一笔）、工具按钮、「写完这一行」导出。
 *
 * 平台：
 * - H5：真 canvas 2D（devicePixelRatio 高清）、全屏 + 横屏方向锁（尽力而为）；
 * - 非 H5（小程序 P2）：降级 view 提示先用键盘，不加载任何 canvas 代码（#ifdef H5）。
 *
 * 硬规则：本组件不做任何识别/判定/门槛；只 emit 原始 ink-v1 JSON（识别由 #21 服务端负责）。
 * 组件契约（apps/student/src/components/README.md）：props modelValue/height/readonly，
 * emits update:modelValue / finish / draw-start，与占位实现兼容。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DEFAULT_ERASER_RADIUS,
  MIN_POINT_DISTANCE,
  appendPoint,
  canRedoInk,
  canUndoInk,
  clearInk,
  commitInkStroke,
  createInkDocument,
  createInkEditState,
  eraseInkAlongPath,
  parseInk,
  redoInk,
  replayInk,
  serializeInk,
  setInkCanvas,
  smoothPoints,
  undoInk,
  visibleStrokes,
  type InkEditState,
  type InkPoint,
} from './ink'

const props = withDefaults(
  defineProps<{
    /** ink-v1 JSON 字符串（v-model） */
    modelValue?: string
    /** 画布高度：数字按 px，字符串原样（默认 100%） */
    height?: number | string
    readonly?: boolean
  }>(),
  { modelValue: '', height: '100%', readonly: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'finish', v: string): void
  (e: 'draw-start'): void
}>()

/** 默认线宽（CSS px）。手写一行字号约 16px，2.6px 接近中性笔。 */
const STROKE_WIDTH = 2.6
/** dpr 上限：避免 4x 屏上像素画布过大导致内存/合成开销（03 §2.2 高清，但按性能预算封顶）。 */
const MAX_DPR = 3

const rootRef = ref<unknown>(null)
const stageRef = ref<unknown>(null)
const tool = ref<'pen' | 'eraser'>('pen')
const fullscreen = ref(false)
const statusText = ref('')
const canUndo = ref(false)
const canRedo = ref(false)
const strokeCount = ref(0)
const drawingFlag = ref(false)

const rootStyle = computed(() => ({
  height: typeof props.height === 'number' ? props.height + 'px' : props.height,
}))

// --- H5 运行时对象（非 H5 构建里由 #ifdef 剥掉使用处，保留声明不产生影响） ---
let editState: InkEditState = createInkEditState(createInkDocument())
let startAt = 0
let inkColor = 'currentColor'
let hostEl: HTMLElement | null = null
let stageEl: HTMLElement | null = null
let baseCanvas: HTMLCanvasElement | null = null
let liveCanvas: HTMLCanvasElement | null = null
let baseCtx: CanvasRenderingContext2D | null = null
let liveCtx: CanvasRenderingContext2D | null = null
let resizeObserver: ResizeObserver | null = null
let rafId = 0
let cssWidth = 0
let cssHeight = 0
let pixelRatio = 1
let activePointerId: number | null = null
let drawing = false
let penOnly = false
let currentPoints: InkPoint[] = []
let eraserPoints: InkPoint[] = []
let lastEmitted = ''
let statusTimer: ReturnType<typeof setTimeout> | null = null

function showStatus(text: string, ms = 2200): void {
  statusText.value = text
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    statusText.value = ''
    statusTimer = null
  }, ms)
}

/** 会话相对时间（ms），写进 ink-v1 每个点的 t。 */
function now(): number {
  // #ifdef H5
  if (typeof performance !== 'undefined') return Math.max(0, Math.round(performance.now() - startAt))
  // #endif
  return 0
}

/** uni-app 里 ref 可能拿到组件实例（$el 才是 DOM）；统一解析成 HTMLElement。 */
function resolveHost(value: unknown): HTMLElement | null {
  // #ifdef H5
  if (value) {
    const target = (value as { $el?: unknown }).$el ?? value
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) return target
  }
  // #endif
  return null
}

function syncReactive(): void {
  canUndo.value = canUndoInk(editState)
  canRedo.value = canRedoInk(editState)
  strokeCount.value = visibleStrokes(editState.doc).length
}

/** 最近一次写入 v-model 的 JSON，用于避免父级回传时反复 load。 */
function emitUpdate(): void {
  // #ifdef H5
  const json = serializeInk(editState)
  if (json === lastEmitted) return
  lastEmitted = json
  emit('update:modelValue', json)
  // #endif
}

/** 从 v-model 载入（只读回放与父级重置都走这里）。 */
function loadModel(json: string, initial = false): void {
  if (!json) {
    editState = createInkEditState(createInkDocument({ width: cssWidth || 1, height: cssHeight || 1, dpr: pixelRatio || 1 }))
    lastEmitted = ''
    syncReactive()
    redrawBase()
    return
  }
  try {
    const doc = parseInk(json)
    editState = createInkEditState(doc)
    if (!initial && cssWidth > 0 && cssHeight > 0) {
      editState = setInkCanvas(editState, { width: cssWidth, height: cssHeight, dpr: pixelRatio })
    }
    lastEmitted = json
    syncReactive()
    redrawBase()
  } catch {
    showStatus('笔迹数据无法解析，已忽略')
  }
}

/** 从 tokens.css 读墨色；拿不到时退回继承的文字颜色（不在组件里硬编码色值）。 */
function readInkColor(): string {
  // #ifdef H5
  const el = hostEl ?? (typeof document !== 'undefined' ? document.body : null)
  if (el) {
    const styles = getComputedStyle(el)
    const token = styles.getPropertyValue('--ink').trim()
    if (token) return token
    if (styles.color) return styles.color
  }
  // #endif
  return 'currentColor'
}

// ---------------------------------------------------------------------------
// H5：创建画布与尺寸
// ---------------------------------------------------------------------------

function setupCanvas(): void {
  // #ifdef H5
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const host = resolveHost(rootRef.value)
  const stage = resolveHost(stageRef.value)
  if (!host || !stage) return
  hostEl = host
  stageEl = stage
  startAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  const base = document.createElement('canvas')
  const live = document.createElement('canvas')
  for (const canvas of [base, live]) {
    canvas.style.position = 'absolute'
    canvas.style.left = '0'
    canvas.style.top = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.touchAction = 'none'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '1'
    stage.appendChild(canvas)
  }
  baseCanvas = base
  liveCanvas = live
  baseCtx = base.getContext('2d')
  liveCtx = live.getContext('2d')

  stage.style.touchAction = 'none'
  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('resize', handleResize)
  window.addEventListener('orientationchange', handleResize)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(stage)
  }

  inkColor = readInkColor()
  loadModel(props.modelValue, true)
  handleResize()
  // #endif
}

function teardownCanvas(): void {
  // #ifdef H5
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  const stage = stageEl
  if (stage) {
    stage.removeEventListener('pointerdown', onPointerDown)
    stage.removeEventListener('pointermove', onPointerMove)
    stage.removeEventListener('pointerup', onPointerUp)
    stage.removeEventListener('pointercancel', onPointerUp)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('orientationchange', handleResize)
  }
  if (typeof document !== 'undefined') document.removeEventListener('fullscreenchange', onFullscreenChange)
  resizeObserver?.disconnect()
  resizeObserver = null
  baseCanvas?.remove()
  liveCanvas?.remove()
  baseCanvas = null
  liveCanvas = null
  baseCtx = null
  liveCtx = null
  hostEl = null
  stageEl = null
  // #endif
}

function handleResize(): void {
  // #ifdef H5
  if (!stageEl || !baseCanvas || !liveCanvas || !baseCtx || !liveCtx) return
  const rect = stageEl.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const dpr = Math.max(1, Math.min(MAX_DPR, Math.round(rawDpr * 100) / 100))
  if (width === cssWidth && height === cssHeight && dpr === pixelRatio) return
  cssWidth = width
  cssHeight = height
  pixelRatio = dpr
  for (const canvas of [baseCanvas, liveCanvas]) {
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
  }
  baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  liveCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // 只读回放保留 ink-v1 里记录的原始画布尺寸，绘制时等比缩放；编辑时同步成当前尺寸
  if (!props.readonly) editState = setInkCanvas(editState, { width, height, dpr })
  redrawBase()
  clearLive()
  // #endif
}

// ---------------------------------------------------------------------------
// H5：绘制（底图整层重绘；当前笔只重绘 live 层）
// ---------------------------------------------------------------------------

function drawStrokePath(
  ctx: CanvasRenderingContext2D,
  points: readonly InkPoint[],
  color: string,
  width: number,
): void {
  if (!points.length) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (points.length === 1) {
    const only = points[0]
    if (only) {
      ctx.beginPath()
      ctx.arc(only[0], only[1], Math.max(0.6, width / 2), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
    return
  }
  ctx.beginPath()
  const first = points[0]
  if (!first) {
    ctx.restore()
    return
  }
  ctx.moveTo(first[0], first[1])
  if (points.length === 2) {
    const second = points[1]
    if (second) ctx.lineTo(second[0], second[1])
  } else {
    // 二次贝塞尔穿过中点：实时书写看起来平滑（数据仍是原始采样点）
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i]
      const next = points[i + 1]
      if (!current || !next) continue
      ctx.quadraticCurveTo(current[0], current[1], (current[0] + next[0]) / 2, (current[1] + next[1]) / 2)
    }
    const last = points[points.length - 1]
    if (last) ctx.lineTo(last[0], last[1])
  }
  ctx.stroke()
  ctx.restore()
}

function redrawBase(): void {
  // #ifdef H5
  const ctx = baseCtx
  const canvas = baseCanvas
  if (!ctx || !canvas) return
  // 先按物理像素清空，再设置绘制变换
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const doc = editState.doc
  let scale = 1
  let offsetX = 0
  let offsetY = 0
  if (props.readonly && doc.canvas.width > 0 && doc.canvas.height > 0) {
    // 回放/缩略图：按 contain 等比缩放，保证「导出的 ink-v1 能重放」不被裁切
    const fit = Math.min(cssWidth / doc.canvas.width, cssHeight / doc.canvas.height)
    if (Number.isFinite(fit) && fit > 0) {
      scale = Math.min(fit, 4)
      offsetX = (cssWidth - doc.canvas.width * scale) / 2
      offsetY = (cssHeight - doc.canvas.height * scale) / 2
    }
  }
  ctx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * offsetX, pixelRatio * offsetY)
  const color = inkColor || readInkColor()
  for (const stroke of visibleStrokes(doc)) {
    drawStrokePath(ctx, stroke.points, stroke.color === 'currentColor' ? color : stroke.color, stroke.width)
  }
  // #endif
}

function clearLive(): void {
  // #ifdef H5
  if (!liveCtx) return
  liveCtx.clearRect(0, 0, cssWidth, cssHeight)
  // #endif
}

function drawLive(): void {
  // #ifdef H5
  const ctx = liveCtx
  if (!ctx) return
  ctx.clearRect(0, 0, cssWidth, cssHeight)
  const color = inkColor || readInkColor()
  if (tool.value === 'eraser') {
    if (eraserPoints.length > 0) {
      ctx.save()
      ctx.globalAlpha = 0.22
      drawStrokePath(ctx, eraserPoints, color, DEFAULT_ERASER_RADIUS * 2)
      ctx.restore()
    }
    return
  }
  if (currentPoints.length > 0) drawStrokePath(ctx, currentPoints, color, STROKE_WIDTH)
  // #endif
}

function scheduleLiveDraw(): void {
  // #ifdef H5
  if (typeof requestAnimationFrame === 'undefined') {
    drawLive()
    return
  }
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    drawLive()
  })
  // #endif
}

// ---------------------------------------------------------------------------
// H5：Pointer Events 采集（pointer capture + coalesced events + 防手掌误触）
// ---------------------------------------------------------------------------

/** 把 PointerEvent 的 clientX/Y 转成画布内 CSS 像素点。 */
function eventPoint(event: PointerEvent): InkPoint {
  // #ifdef H5
  const stage = stageEl
  if (stage) {
    const rect = stage.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, now()]
  }
  // #endif
  return [0, 0, 0]
}

/** 取 coalesced events 补齐高频采样（03 §2.2）；不支持时退回单事件。 */
function collectPointerEvents(event: PointerEvent): PointerEvent[] {
  // #ifdef H5
  if (typeof event.getCoalescedEvents === 'function') {
    const coalesced = event.getCoalescedEvents()
    if (coalesced.length > 0) return coalesced
  }
  // #endif
  return [event]
}

function onPointerDown(event: PointerEvent): void {
  // #ifdef H5
  if (props.readonly || drawing) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  // 防手掌误触：本会话一旦出现笔，就只接受笔（03 §2.2）
  if (penOnly && event.pointerType !== 'pen') return
  if (event.pointerType === 'pen') penOnly = true
  const stage = stageEl
  if (!stage) return
  event.preventDefault()
  activePointerId = event.pointerId
  drawing = true
  drawingFlag.value = true
  statusText.value = ''
  try {
    stage.setPointerCapture(event.pointerId)
  } catch {
    // 个别 WebView 不支持 pointer capture；靠 pointerId 过滤即可
  }
  if (tool.value === 'eraser') {
    eraserPoints = [eventPoint(event)]
    scheduleLiveDraw()
    return
  }
  const wasEmpty = visibleStrokes(editState.doc).length === 0
  currentPoints = [eventPoint(event)]
  if (wasEmpty) emit('draw-start')
  scheduleLiveDraw()
  // #endif
}

function onPointerMove(event: PointerEvent): void {
  // #ifdef H5
  if (!drawing || event.pointerId !== activePointerId) return
  if (penOnly && event.pointerType !== 'pen') return
  event.preventDefault()
  const events = collectPointerEvents(event)
  if (tool.value === 'eraser') {
    for (const item of events) eraserPoints = appendPoint(eraserPoints, eventPoint(item), 2)
    scheduleLiveDraw()
    return
  }
  for (const item of events) currentPoints = appendPoint(currentPoints, eventPoint(item), MIN_POINT_DISTANCE)
  scheduleLiveDraw()
  // #endif
}

function onPointerUp(event: PointerEvent): void {
  // #ifdef H5
  if (!drawing || event.pointerId !== activePointerId) return
  drawing = false
  drawingFlag.value = false
  activePointerId = null
  const stage = stageEl
  if (stage) {
    try {
      stage.releasePointerCapture(event.pointerId)
    } catch {
      // ignore
    }
  }

  if (tool.value === 'eraser') {
    if (eraserPoints.length > 0) {
      const before = visibleStrokes(editState.doc).length
      editState = eraseInkAlongPath(editState, eraserPoints, DEFAULT_ERASER_RADIUS, now())
      const removed = before - visibleStrokes(editState.doc).length
      if (removed > 0) {
        showStatus('已擦除 ' + removed + ' 笔（可撤销）')
        afterChange()
      }
    }
    eraserPoints = []
    clearLive()
    return
  }

  if (currentPoints.length > 0) {
    const result = commitInkStroke(
      editState,
      { points: smoothPoints(currentPoints, 3), color: inkColor || 'currentColor', width: STROKE_WIDTH },
      now(),
    )
    editState = result.state
    if (result.scratch?.matched) {
      showStatus('已划掉 ' + result.scratch.coveredIds.length + ' 笔（可撤销）')
    }
    currentPoints = []
    clearLive()
    afterChange()
  }
  // #endif
}

/** 提交/撤销/删除后统一收尾：同步按钮态、重画底图、写回 v-model。 */
function afterChange(): void {
  syncReactive()
  redrawBase()
  emitUpdate()
}

// ---------------------------------------------------------------------------
// 工具按钮
// ---------------------------------------------------------------------------

function onUndo(): void {
  if (props.readonly) return
  editState = undoInk(editState, now())
  afterChange()
  clearLive()
}

function onRedo(): void {
  if (props.readonly) return
  editState = redoInk(editState, now())
  afterChange()
  clearLive()
}

function onToggleEraser(): void {
  if (props.readonly) return
  tool.value = tool.value === 'pen' ? 'eraser' : 'pen'
  showStatus(tool.value === 'eraser' ? '橡皮：划过要删的笔画' : '')
}

function onClear(): void {
  if (props.readonly) return
  if (visibleStrokes(editState.doc).length === 0) return
  editState = clearInk(editState, now())
  showStatus('已清空（可撤销）')
  afterChange()
}

function onFullscreenChange(): void {
  // #ifdef H5
  if (typeof document === 'undefined') return
  fullscreen.value = Boolean(document.fullscreenElement)
  // #endif
}

async function onToggleFullscreen(): Promise<void> {
  // #ifdef H5
  if (typeof document === 'undefined') return
  try {
    if (!document.fullscreenElement) {
      const host = hostEl
      if (!host || typeof host.requestFullscreen !== 'function') {
        showStatus('当前浏览器不支持全屏')
        return
      }
      await host.requestFullscreen()
      // 横屏方向锁是加分项：桌面/部分浏览器不支持，失败不影响全屏
      try {
        const orientation = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation
        await orientation?.lock?.('landscape')
      } catch {
        // ignore
      }
      fullscreen.value = true
    } else {
      await document.exitFullscreen()
      try {
        const orientation = (screen as unknown as { orientation?: { unlock?: () => void } }).orientation
        orientation?.unlock?.()
      } catch {
        // ignore
      }
      fullscreen.value = false
    }
  } catch {
    showStatus('当前浏览器不支持全屏')
  }
  // #endif
}

/** 「写完这一行」：导出 ink-v1 并交给父级（识别由 #21 服务端接）。 */
function onFinish(): void {
  // #ifdef H5
  if (props.readonly) return
  const json = serializeInk(editState)
  lastEmitted = json
  emit('update:modelValue', json)
  emit('finish', json)
  // #endif
}

// ---------------------------------------------------------------------------
// 生命周期 / v-model 同步
// ---------------------------------------------------------------------------

onMounted(() => {
  // #ifdef H5
  setupCanvas()
  // #endif
})

onBeforeUnmount(() => {
  // #ifdef H5
  teardownCanvas()
  // #endif
})

watch(
  () => props.modelValue,
  (value) => {
    // #ifdef H5
    if (!value) {
      if (props.readonly) {
        loadModel('', true)
      } else {
        editState = createInkEditState(createInkDocument({ width: cssWidth || 1, height: cssHeight || 1, dpr: pixelRatio || 1 }))
        lastEmitted = ''
        syncReactive()
        redrawBase()
      }
      return
    }
    if (value === lastEmitted) return
    loadModel(value)
    // #endif
  },
)

// 只读模式切换时不需要重新采集，仅同步一次按钮态（模板里只读不渲染工具条）
watch(
  () => props.readonly,
  () => {
    syncReactive()
  },
)
</script>

<template>
  <view
    ref="rootRef"
    class="ui-ink-canvas"
    :class="{ 'ui-ink-canvas--readonly': props.readonly, 'ui-ink-canvas--fullscreen': fullscreen }"
    :style="rootStyle"
  >
    <!-- #ifdef H5 -->
    <view ref="stageRef" class="ui-ink-canvas__stage">
      <view v-if="!props.readonly && strokeCount === 0 && !drawingFlag" class="ui-ink-canvas__hint">
        <text class="ui-ink-canvas__hinttext">在这里写一行；写错了直接划掉（来回涂抹）删除</text>
      </view>
      <view v-if="statusText" class="ui-ink-canvas__status">
        <text class="ui-ink-canvas__statustext">{{ statusText }}</text>
      </view>
    </view>
    <view v-if="!props.readonly" class="ui-ink-canvas__bar">
      <button class="ui-ink-canvas__tool" :disabled="!canUndo" @tap="onUndo">撤销</button>
      <button class="ui-ink-canvas__tool" :disabled="!canRedo" @tap="onRedo">重做</button>
      <button
        class="ui-ink-canvas__tool"
        :class="{ 'ui-ink-canvas__tool--active': tool === 'eraser' }"
        @tap="onToggleEraser"
      >
        {{ tool === 'eraser' ? '画笔' : '橡皮' }}
      </button>
      <button class="ui-ink-canvas__tool" :disabled="strokeCount === 0" @tap="onClear">清空</button>
      <button class="ui-ink-canvas__tool" @tap="onToggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏' }}</button>
      <button class="ui-ink-canvas__tool ui-ink-canvas__tool--primary" :disabled="strokeCount === 0" @tap="onFinish">
        写完这一行
      </button>
    </view>
    <!-- #endif -->

    <!-- #ifndef H5 -->
    <view class="ui-ink-canvas__fallback">
      <text class="ui-ink-canvas__hinttext">当前端暂不支持手写（小程序 P2 再接 canvas 2d），请先用键盘输入。</text>
    </view>
    <!-- #endif -->
  </view>
</template>

<style>
.ui-ink-canvas {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 160px;
  background: var(--sheet);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  overflow: hidden;
  box-sizing: border-box;
}
.ui-ink-canvas__stage {
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  touch-action: none;
  overscroll-behavior: contain;
  background-color: var(--sheet);
  background-image: linear-gradient(var(--rule), var(--rule)), linear-gradient(var(--rule), var(--rule));
  background-size: 100% 1px, 100% 1px;
  background-position: 0 33.33%, 0 66.66%;
  background-repeat: no-repeat;
  cursor: crosshair;
}
.ui-ink-canvas__hint {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  z-index: 3;
  transform: translateY(-50%);
  padding: 0 var(--sp-4);
  text-align: center;
  pointer-events: none;
}
.ui-ink-canvas__hinttext {
  color: var(--ink-2);
  font-size: var(--fs-small);
  line-height: 1.6;
}
.ui-ink-canvas__status {
  position: absolute;
  left: var(--sp-2);
  bottom: var(--sp-2);
  z-index: 3;
  padding: 2px var(--sp-2);
  background: var(--accent-soft);
  border-radius: var(--radius-input);
  pointer-events: none;
}
.ui-ink-canvas__statustext {
  color: var(--ink);
  font-size: 12px;
  line-height: 1.5;
}
.ui-ink-canvas__bar {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-1) var(--sp-2);
  overflow-x: auto;
  background: var(--sheet);
  border-top: 1px solid var(--rule);
}
.ui-ink-canvas__tool {
  flex: 0 0 auto;
  min-width: 44px;
  min-height: 44px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  line-height: 1.2;
}
.ui-ink-canvas__tool::after {
  border: none;
}
.ui-ink-canvas__tool[disabled] {
  opacity: 0.45;
  /* 覆盖 uni-button 自带的 [disabled] 灰底/灰字（深色模式下会变成亮灰块），颜色仍走 token */
  background: transparent;
  color: var(--ink);
  border-color: var(--rule);
}
.ui-ink-canvas__tool--active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.ui-ink-canvas__tool--primary {
  margin-left: auto;
  border-color: var(--accent);
  color: var(--accent);
}
.ui-ink-canvas--readonly {
  cursor: default;
}
.ui-ink-canvas--readonly .ui-ink-canvas__stage {
  cursor: default;
}
.ui-ink-canvas--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 90;
  height: 100vh;
  height: 100dvh;
  border: 0;
  border-radius: 0;
}
.ui-ink-canvas__fallback {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  text-align: center;
}
</style>
