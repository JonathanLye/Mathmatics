<script setup lang="ts">
/**
 * ink-v1 手写画布（issue #14，格式严格按 10-开发文档/03-手写键盘与识别.md §2.1）。
 *
 * 分工：
 * - 数据/平滑/撤销/橡皮/划掉删除/序列化/重放全部在 ./ink.ts 纯逻辑里（不依赖 DOM）；
 * - 上传编码（gzip + base64，≤256KB）在 ./inkCapture.ts；
 * - 本组件只负责：H5 事件采集（Pointer Events + pointer capture + coalesced events + 压感）、
 *   canvas 2D 渲染（perfect-freehand 可变线宽，双画布保证每帧只重绘当前一笔）、
 *   工具按钮、「写完这一行」：同时 emit 原始 JSON（update:modelValue）与 gzip(JSON) 的 base64（finish）。
 *
 * 采集字段（03 §2.1 / §2.6）：
 * - p：pen / touch / mouse（PointerEvent.pointerType）；
 * - pressure：0–1，设备不支持压感时固定 0.5；
 * - t：相对 t0 的毫秒；t0 为会话起始的墙钟时间；
 * - w/h/dpr/orientation/fullscreen：尺寸、朝向、全屏状态，在落笔开始/结束与方向、全屏切换时同步进文档。
 *
 * 平台：H5 用真 canvas；非 H5（小程序 P2）走 #ifndef 降级 view。
 * 本组件不做任何识别/判定；识别由 #21 服务端负责。
 * 组件契约（apps/student/src/components/README.md）：props modelValue/height/readonly，
 * emits update:modelValue / finish / draw-start，与占位实现兼容（finish 载荷按审计要求改为 gzip base64）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getStroke } from 'perfect-freehand'
import {
  DEFAULT_ERASER_RADIUS,
  DEFAULT_PRESSURE,
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
  serializeInk,
  setInkMeta,
  smoothPoints,
  undoInk,
  visibleStrokes,
  type InkDocument,
  type InkEditState,
  type InkOrientation,
  type InkPoint,
  type InkPointerType,
  type InkStroke,
} from './ink'
import { buildInkCapture } from './inkCapture'

const props = withDefaults(
  defineProps<{
    /** ink-v1 JSON 字符串（v-model，03 §2.1） */
    modelValue?: string
    /** 画布高度：数字按 px，字符串原样（默认 100%） */
    height?: number | string
    readonly?: boolean
  }>(),
  { modelValue: '', height: '100%', readonly: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  /** 写完这一行：gzip(JSON) 的 base64，可直接作为 /recognitions/ink 的 ink 字段（≤256KB） */
  (e: 'finish', gzipBase64: string): void
  (e: 'draw-start'): void
}>()

/** perfect-freehand 的笔迹最大直径（CSS px）。 */
const INK_STROKE_SIZE = 3.2
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
const finishing = ref(false)

const rootStyle = computed(() => ({
  height: typeof props.height === 'number' ? props.height + 'px' : props.height,
}))

// --- H5 运行时对象（非 H5 构建里由 #ifdef 剥掉使用处，保留声明不产生影响） ---
let editState: InkEditState = createInkEditState(createInkDocument())
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
let currentPointerType: InkPointerType = 'touch'
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

/** 画布朝向（03 §2.6：方向变化写进 ink-v1）。 */
function readOrientation(): InkOrientation {
  // #ifdef H5
  if (typeof window !== 'undefined') return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'
  // #endif
  return 'portrait'
}

/** 会话相对时间（ms）：t = 当前墙钟 - t0（03 §2.1）。 */
function now(): number {
  const t0 = editState.doc.t0
  if (!(t0 > 0)) return 0
  return Math.max(0, Math.round(Date.now() - t0))
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

/** 最近一次写入 v-model 的原始 JSON，用于避免父级回传时反复 load。 */
function emitUpdate(): void {
  // #ifdef H5
  const rawJson = serializeInk(editState)
  if (rawJson === lastEmitted) return
  lastEmitted = rawJson
  emit('update:modelValue', rawJson)
  // #endif
}

/** 新建会话文档：尺寸/朝向/全屏/t0 都按当前环境记录（03 §2.1/§2.6）。 */
function createSessionDoc(): InkDocument {
  return createInkDocument({
    w: Math.max(1, cssWidth || 1),
    h: Math.max(1, cssHeight || 1),
    dpr: pixelRatio || 1,
    t0: Date.now(),
    orientation: readOrientation(),
    fullscreen: fullscreen.value,
  })
}

/** 从 v-model 载入（只读回放与父级重置都走这里）。 */
function loadModel(json: string, initial = false): void {
  if (!json) {
    editState = createInkEditState(createSessionDoc())
    lastEmitted = ''
    syncReactive()
    redrawBase()
    return
  }
  try {
    const doc = parseInk(json)
    editState = createInkEditState(doc)
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
// H5：画布创建与元信息同步
// ---------------------------------------------------------------------------

function setupCanvas(): void {
  // #ifdef H5
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const host = resolveHost(rootRef.value)
  const stage = resolveHost(stageRef.value)
  if (!host || !stage) return
  hostEl = host
  stageEl = stage

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

  measureViewport()
  editState = createInkEditState(createSessionDoc())
  inkColor = readInkColor()
  loadModel(props.modelValue, true)
  handleResize()
  syncReactive()
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

/** 尺寸/dpr 变化时重设像素画布（CSS 尺寸 × dpr）并保持 2D 变换。 */
function measureViewport(): boolean {
  // #ifdef H5
  const stage = stageEl
  const base = baseCanvas
  const live = liveCanvas
  const baseContext = baseCtx
  const liveContext = liveCtx
  if (!stage || !base || !live || !baseContext || !liveContext) return false
  const rect = stage.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const rawDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const dpr = Math.max(1, Math.min(MAX_DPR, Math.round(rawDpr * 100) / 100))
  cssWidth = width
  cssHeight = height
  pixelRatio = dpr
  for (const canvas of [base, live]) {
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
  }
  baseContext.setTransform(dpr, 0, 0, dpr, 0, 0)
  liveContext.setTransform(dpr, 0, 0, dpr, 0, 0)
  return true
  // #endif
  return false
}

/**
 * 把尺寸/朝向/全屏同步进 ink-v1 文档（03 §2.6）。
 * 在落笔开始/结束、窗口尺寸变化、方向变化、全屏切换时调用。
 */
function syncMeta(): void {
  // #ifdef H5
  if (props.readonly || !stageEl) return
  const rect = stageEl.getBoundingClientRect()
  editState = setInkMeta(editState, {
    w: Math.max(1, Math.round(rect.width)),
    h: Math.max(1, Math.round(rect.height)),
    dpr: pixelRatio || 1,
    orientation: readOrientation(),
    fullscreen: fullscreen.value,
  })
  // #endif
}

function handleResize(): void {
  // #ifdef H5
  measureViewport()
  syncMeta()
  redrawBase()
  clearLive()
  // #endif
}

// ---------------------------------------------------------------------------
// H5：渲染（perfect-freehand 可变线宽；底图整层重绘，当前笔只重绘 live 层）
// ---------------------------------------------------------------------------

/** 用 perfect-freehand 把一笔转成填充轮廓（输入 [x, y, pressure]，03 §2.2 可变线宽）。 */
function strokeOutline(stroke: InkStroke): number[][] {
  if (stroke.pts.length < 2) return []
  const input: number[][] = stroke.pts.map((point) => [point[0], point[1], point[3]])
  return getStroke(input, {
    size: INK_STROKE_SIZE,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: stroke.p !== 'pen',
    last: true,
  })
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: readonly number[][], color: string): void {
  const first = outline[0]
  if (!first) return
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
  for (let i = 1; i < outline.length; i++) {
    const point = outline[i]
    if (point) ctx.lineTo(point[0] ?? 0, point[1] ?? 0)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawInkStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, color: string): void {
  const points = stroke.pts
  if (!points.length) return
  if (points.length === 1) {
    const point = points[0]
    if (!point) return
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(point[0], point[1], Math.max(0.6, (INK_STROKE_SIZE / 2) * (0.6 + 0.4 * point[3])), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  fontSmoothingHint()
  fillOutline(ctx, strokeOutline(stroke), color)
}

/** 空实现占位：保留调用点，避免未来加入样式细节时忘记（当前无操作）。 */
function fontSmoothingHint(): void {
  // 目前不需要额外处理；保留函数让绘制流程可读
}

function drawEraserTrail(ctx: CanvasRenderingContext2D, points: readonly InkPoint[], color: string): void {
  if (!points.length) return
  ctx.save()
  ctx.globalAlpha = 0.22
  ctx.strokeStyle = color
  ctx.lineWidth = DEFAULT_ERASER_RADIUS * 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const first = points[0]
  if (!first) {
    ctx.restore()
    return
  }
  ctx.beginPath()
  ctx.moveTo(first[0], first[1])
  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    if (point) ctx.lineTo(point[0], point[1])
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
  if (props.readonly && doc.w > 0 && doc.h > 0) {
    // 回放/缩略图：按 contain 等比缩放，保证导出的 ink-v1 重放不被裁切
    const fit = Math.min(cssWidth / doc.w, cssHeight / doc.h)
    if (Number.isFinite(fit) && fit > 0) {
      scale = Math.min(fit, 4)
      offsetX = (cssWidth - doc.w * scale) / 2
      offsetY = (cssHeight - doc.h * scale) / 2
    }
  }
  ctx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * offsetX, pixelRatio * offsetY)
  const color = inkColor || readInkColor()
  for (const stroke of visibleStrokes(doc)) drawInkStroke(ctx, stroke, color)
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
    drawEraserTrail(ctx, eraserPoints, color)
    return
  }
  if (currentPoints.length > 0) {
    drawInkStroke(ctx, { id: -1, p: currentPointerType, pts: currentPoints }, color)
  }
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
// H5：Pointer Events 采集（pointer capture + coalesced events + 防手掌误触 + 压感）
// ---------------------------------------------------------------------------

/** 压感：设备不支持时固定 0.5（03 §2.1）。 */
function readPressure(event: PointerEvent): number {
  const raw = event.pressure
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 1) {
    return Math.round(raw * 1000) / 1000
  }
  return DEFAULT_PRESSURE
}

/** p 字段：PointerEvent.pointerType 归一化成 pen / touch / mouse（03 §2.1）。 */
function readPointerType(event: PointerEvent): InkPointerType {
  const type = event.pointerType
  if (type === 'pen' || type === 'mouse') return type
  return 'touch'
}

/** 把 PointerEvent 的 clientX/Y 转成画布内 CSS 像素点（含 t 与 pressure）。 */
function eventPoint(event: PointerEvent): InkPoint {
  // #ifdef H5
  const stage = stageEl
  if (stage) {
    const rect = stage.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top))
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, now(), readPressure(event)]
  }
  // #endif
  return [0, 0, 0, DEFAULT_PRESSURE]
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
  syncMeta() // 落笔开始：把尺寸/朝向/全屏写进 ink-v1（03 §2.6）
  activePointerId = event.pointerId
  drawing = true
  drawingFlag.value = true
  currentPointerType = readPointerType(event)
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
    syncMeta()
    return
  }

  if (currentPoints.length > 0) {
    const result = commitInkStroke(
      editState,
      { pts: smoothPoints(currentPoints, 3), p: currentPointerType },
      now(),
    )
    editState = result.state
    if (result.scratch?.matched) showStatus('已划掉 ' + result.scratch.coveredIds.length + ' 笔（可撤销）')
    currentPoints = []
    clearLive()
    syncMeta() // 落笔结束：同步一次元信息（03 §2.6）
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
  syncMeta() // 全屏状态变化写进 ink-v1（03 §2.6）
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
    syncMeta()
  } catch {
    showStatus('当前浏览器不支持全屏')
  }
  // #endif
}

/**
 * 「写完这一行」：
 * 1) 原始 ink-v1 JSON 通过 update:modelValue 交给父级（回放/草稿用）；
 * 2) gzip(JSON) 的 base64 通过 finish 交给父级（openapi /recognitions/ink 的 ink 字段，≤256KB）。
 */
async function onFinish(): Promise<void> {
  // #ifdef H5
  if (props.readonly || finishing.value) return
  finishing.value = true
  try {
    const rawJson = serializeInk(editState)
    lastEmitted = rawJson
    emit('update:modelValue', rawJson)
    const capture = await buildInkCapture(editState)
    if (capture.overLimit) {
      showStatus('笔迹超过 256 KB，已抽稀仍超限，请精简后再试', 3600)
    } else if (capture.simplified) {
      showStatus('笔迹较大，已按 1px 距离抽稀后打包', 3200)
    }
    emit('finish', capture.base64)
  } catch {
    showStatus('打包笔迹失败，请重试')
  } finally {
    finishing.value = false
  }
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
    if (!value) {
      // #ifdef H5
      if (props.readonly) {
        loadModel('', true)
      } else {
        editState = createInkEditState(createSessionDoc())
        lastEmitted = ''
        syncReactive()
        redrawBase()
      }
      // #endif
      return
    }
    // #ifdef H5
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

defineExpose({
  /** 当前原始 ink-v1 JSON（测试/父级回放用）。 */
  getInkJson: (): string => serializeInk(editState),
  /** 上传用 gzip(JSON) 的 base64（03 §2.1，≤256KB）。 */
  buildInkCapture: () => buildInkCapture(editState),
})
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
      <button
        class="ui-ink-canvas__tool ui-ink-canvas__tool--primary"
        :disabled="strokeCount === 0 || finishing"
        @tap="onFinish"
      >
        {{ finishing ? '打包中…' : '写完这一行' }}
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
