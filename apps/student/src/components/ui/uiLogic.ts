/**
 * 组件库的纯逻辑（无 DOM，tests/ui-logic.test.ts 覆盖）。
 * 组件只管模板和样式；类名、禁用、进度分段、聚光灯几何这些规则放在这里。
 */
import { ref } from 'vue'

// ---- PgButton ----
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'hint' | 'sea'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonState {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  stack?: boolean
  loading?: boolean
  disabled?: boolean
}

/** 加载中也不能再点：防止重复提交。 */
export function buttonDisabled(state: ButtonState): boolean {
  return Boolean(state.disabled || state.loading)
}

export function buttonClasses(state: ButtonState): string[] {
  const out = ['pg-button--' + (state.variant ?? 'primary'), 'pg-button--' + (state.size ?? 'md')]
  if (state.block) out.push('pg-button--block')
  if (state.stack) out.push('pg-button--stack')
  if (state.loading) out.push('pg-button--loading')
  return out
}

// ---- PgMascot ----
export type MascotMotion = 'breathe' | 'blink' | 'hop' | 'cheer' | 'think-tilt' | 'droop'

export function mascotMotionClasses(motion: MascotMotion | readonly MascotMotion[] | null | undefined): string[] {
  if (!motion) return []
  const list = typeof motion === 'string' ? [motion] : motion
  return list.map((name) => 'pg-mascot--' + name)
}

// ---- PgProgress ----
export type SegmentState = 'done' | 'active' | 'todo' | 'skipped' | 'off'

/** 层状态 → 进度段状态（locked 就是还没到）。 */
export function segmentFromLayerStatus(status: string): SegmentState {
  if (status === 'done') return 'done'
  if (status === 'active') return 'active'
  if (status === 'skipped') return 'skipped'
  if (status === 'disabled') return 'off'
  return 'todo'
}

/** 连续进度夹到 0–1，并把坏值当 0。 */
export function clampProgress(value: number | null | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** 只有往前走才闪光；回退或初次渲染不闪。 */
export function shouldShine(previous: number | null, next: number): boolean {
  return previous !== null && next > previous
}

/** 分段进度的完成量：用于 aria-valuenow 和闪光判断。 */
export function segmentsProgress(segments: readonly SegmentState[]): number {
  return segments.reduce((sum, state) => sum + (state === 'done' || state === 'skipped' ? 1 : state === 'active' ? 0.5 : 0), 0)
}

// ---- PgSegmented ----
/** 方向键切换：循环移动，跳过禁用项；全都禁用时不动。 */
export function nextSegmentIndex(current: number, delta: 1 | -1, disabled: readonly boolean[]): number {
  const n = disabled.length
  if (n === 0) return current
  for (let step = 1; step <= n; step += 1) {
    const candidate = (current + delta * step + n * step) % n
    if (!disabled[candidate]) return candidate
  }
  return current
}

// ---- PgSwitch ----
export function switchNextValue(value: boolean, disabled: boolean): boolean {
  return disabled ? value : !value
}

// ---- PgSheet ----
/** 遮罩和 Esc 能不能关：persistent（比如请求在途）时都不行。 */
export function canDismiss(persistent: boolean | undefined): boolean {
  return !persistent
}

/** 打开着的弹层，后开的在最上面。叠起来时 Esc 只关最上面一层。 */
const openSheets: object[] = []
/** 打开着的弹层/庆祝层数量（响应式）：小方入口据此在有弹层时躲开。 */
export const openOverlayCount = ref(0)
export function sheetOpened(sheet: object): void {
  sheetClosed(sheet)
  openSheets.push(sheet)
  openOverlayCount.value = openSheets.length
}
export function sheetClosed(sheet: object): void {
  const at = openSheets.indexOf(sheet)
  if (at >= 0) openSheets.splice(at, 1)
  openOverlayCount.value = openSheets.length
}
export function isTopSheet(sheet: object): boolean {
  return openSheets[openSheets.length - 1] === sheet
}

// ---- PgTabBar ----
export type TabKey = 'path' | 'practice' | 'mistakes' | 'proofbook' | 'me'

export interface TabItem {
  key: TabKey
  label: string
  icon: 'path' | 'pen' | 'redo' | 'book' | 'me'
  url: string
  testid: string
  /** 第二个稳定锚点（新手引导按它定位）；和标签同样大小，不改变原有 testid。 */
  anchorTestid?: string
}

export const TAB_ITEMS: readonly TabItem[] = [
  { key: 'path', label: '路径', icon: 'path', url: '/pages/home/index', testid: 'tab-path' },
  // 路由叫 practice-zone：pages/practice 是写证明的工作台。
  { key: 'practice', label: '练习', icon: 'pen', url: '/pages/practice-zone/index', testid: 'tab-practice' },
  { key: 'mistakes', label: '错题', icon: 'redo', url: '/pages/mistakes/index', testid: 'tab-mistakes' },
  // 沿用旧 testid：首页“证明本”入口一直叫这个名字。
  { key: 'proofbook', label: '证明本', icon: 'book', url: '/pages/proofbook/index', testid: 'home-proofbook' },
  { key: 'me', label: '我的', icon: 'me', url: '/pages/me/index', testid: 'tab-me', anchorTestid: 'nav-me' },
]

/** 点已激活的标签不跳转。 */
export function tabTarget(active: TabKey | null | undefined, key: TabKey): string | null {
  if (active === key) return null
  return TAB_ITEMS.find((item) => item.key === key)?.url ?? null
}

// ---- PgCoachmark ----
export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** 聚光灯的洞：目标外扩 padding，并夹在视口内。 */
export function spotlightRect(target: Rect, viewport: Viewport, padding = 8): Rect {
  const left = Math.max(0, target.left - padding)
  const top = Math.max(0, target.top - padding)
  const right = Math.min(viewport.width, target.left + target.width + padding)
  const bottom = Math.min(viewport.height, target.top + target.height + padding)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

export interface BubblePlacement {
  side: 'below' | 'above'
  top: number
  left: number
  width: number
}

/** 气泡放在洞的下方；下方放不下才放上方；水平方向对齐洞并留边距。 */
export function coachmarkBubble(hole: Rect, viewport: Viewport, bubbleHeight: number, gap = 12, margin = 16, maxWidth = 360): BubblePlacement {
  const width = Math.min(maxWidth, viewport.width - margin * 2)
  const centered = hole.left + hole.width / 2 - width / 2
  const left = Math.max(margin, Math.min(centered, viewport.width - margin - width))
  const below = hole.top + hole.height + gap
  if (below + bubbleHeight <= viewport.height - margin) return { side: 'below', top: below, left, width }
  const above = hole.top - gap - bubbleHeight
  if (above >= margin) return { side: 'above', top: above, left, width }
  // 上下都放不下（目标几乎占满屏）：贴底显示。
  return { side: 'below', top: Math.max(margin, viewport.height - margin - bubbleHeight), left, width }
}

/** 下一步：最后一步之后返回 null，表示引导结束。 */
export function coachmarkNext(index: number, total: number): number | null {
  return index + 1 < total ? index + 1 : null
}

// ---- 错误边界 ----
/**
 * 判断 Vue 上报的错误会不会让页面画不出来。
 * 只有 setup 和 render 出错才算致命（整页换成错误页）；点击回调、网络请求失败只提示，不砸掉页面。
 * 开发构建的 info 是文字，生产构建是 https://vuejs.org/error-reference/#runtime-N（0=setup，1=render）。
 */
export function isFatalVueError(info: string | null | undefined): boolean {
  const value = String(info ?? '')
  return /setup function|render function/.test(value) || /#runtime-[01]$/.test(value)
}

/** 崩溃页“再试一次”的目标：只接受站内页面路由，且不能回到兜底页自己（否则死循环）。 */
export function retryRoute(from: string | null | undefined): string | null {
  const value = String(from ?? '')
  if (!/^\/pages\/[\w/-]+(\?.*)?$/.test(value) || value.startsWith('/pages/not-found/')) return null
  return value
}
