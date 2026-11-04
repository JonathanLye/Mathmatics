<script setup lang="ts">
/**
 * 做题页（issue #10/#11/#12/#16 的集成页）。
 * 只渲染 AttemptState；不做层/预算/门槛/归类判定（08 §8 AI 规则 3）。
 * 布局：手机单列 + 底部操作坞；平板两栏；桌面三栏（02 §3）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import TopBar from '@/components/TopBar.vue'
import LayerNav from '@/components/LayerNav.vue'
import LayerSheet from '@/components/LayerSheet.vue'
import ProblemCard from '@/components/ProblemCard.vue'
import BudgetBar from '@/components/BudgetBar.vue'
import BottomDock from '@/components/BottomDock.vue'
import MockSwitcher from '@/components/MockSwitcher.vue'
import Layer1Form from '@/components/layers/Layer1Form.vue'
import Layer2Form from '@/components/layers/Layer2Form.vue'
import ProofLineList from '@/components/layers/ProofLineList.vue'
import SelfcheckForm from '@/components/layers/SelfcheckForm.vue'
import TransferForm from '@/components/layers/TransferForm.vue'
import TransferAttempt from '@/components/layers/TransferAttempt.vue'
import SummaryForm from '@/components/layers/SummaryForm.vue'
import MicroCourse from '@/components/MicroCourse.vue'
import HelpDrawer from '@/components/HelpDrawer.vue'
import HintPreviewCard from '@/components/HintPreviewCard.vue'
import EditorSheet from '@/components/EditorSheet.vue'
import OfflineBar from '@/components/OfflineBar.vue'
// #46 严格测验模式（11 §5.2/5.3）：说明页、水印、切出警告、锁定遮罩
import ExamIntro from '@/components/exam/ExamIntro.vue'
import ExamWatermark from '@/components/exam/ExamWatermark.vue'
import ExamLeaveModal from '@/components/exam/ExamLeaveModal.vue'
import ExamLockOverlay from '@/components/exam/ExamLockOverlay.vue'
import {
  examAllowedHelp,
  examDeadlineMs,
  examLocked,
  examMaxWarnings,
  examWarnings,
  examWatermarkCode,
  formatCountdown,
  isExamTimeUp,
  isFullscreen,
  isStrictExam,
  remainingMs,
  requestExamFullscreen,
  serverOffsetMs,
  shouldBlockClipboard,
  shouldShowLeaveWarning,
  watermarkText,
} from '@/components/exam/exam'
import { installExamMockHook } from '@/mocks/examSim'
import { useSession } from '@/stores/session'
import { initIntegrity } from '@/integrity/sdk'
import { getDraftStore } from '@/storage/drafts'
import { filterDismissedNotes, formatNoteTime, mergeNotes, nextLineNoOf, parseNote } from '@/components/layers/proofLines'
import MathText from '@ui-math/MathText.vue'
import RecognitionConfirm from '@ui-math/RecognitionConfirm.vue'
import { takePendingAttempt, useAttempt } from '@/stores/attempt'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { softLandingLabel } from '@/components/hintPreviewCopy'
import { useViewport } from '@/composables/useViewport'
import { parseMockKey, type MockKey } from '@/mocks/attemptStates'
import {
  addLine,
  addTransferLine,
  claimHint,
  completeTransferParent,
  deleteTransferLine,
  editTransferLine,
  fetchLesson,
  finishSteps,
  finishTransfer,
  getAttempt,
  isMockMode,
  recognizeInk,
  setMockMode,
  requestHelp,
  skipLayer,
  startAttempt,
  startTransfer,
  submitDef,
  submitFramework,
  submitSelfcheck,
  submitSummary,
  viewFrameTemplate,
} from '@/api/client'
import type {
  AttemptState,
  HelpIntent,
  HintPreview,
  InputProvenance,
  LayerId,
  LessonView,
  LineDraft,
  Note,
  Recognition,
} from '@/types/attempt'

const { state, mockKey, busy, error, setMock, apply, run } = useAttempt()
const { mode } = useViewport()
const { me: sessionMe } = useSession()
/** 真实模式（#24）：页面按服务端 state 渲染；mock 模式保留四份演示状态切换。 */
const realMode = ref(!isMockMode())

const layersOpen = ref(false)
const editorOpen = ref(false)
const helpOpen = ref(false)
const hintPreview = ref<HintPreview | null>(null)
/** /help 返回的 note 卡片（H0/H1 提示、概念解释、施压拒绝、off_topic 都在抽屉里，01 §4） */
const helpNote = ref<Note | null>(null)
/**
 * #151（#141 P2-1 A 侧）：check_line 的行批注本地渲染。
 *
 * B 的 #141 目前只在 HelpResult 里返回 res.note、不写 state.notes（落库/事件由 B 侧跟进）。
 * 前端把本次会话拿到的行批注放这里，和 state.notes（刷新/重连后由服务端下发）按 noteId 去重合并后渲染；
 * 关闭只影响本页展示，不回写服务端（不伪造持久化）。B 落库后刷新即可由 state.notes 恢复。
 */
const sessionLineNotes = ref<Note[]>([])
/** 学生手动关闭的批注 id（只影响本页展示；刷新后以服务端 state 为准）。 */
const dismissedNoteIds = ref<Set<string>>(new Set())
/** 最近一次求助请求：预览卡「重新获取预览」/ dwell 归零时按原意图重放 */
const lastHelp = ref<{ intent: HelpIntent; text: string }>({ intent: 'concept', text: '' })
const toast = ref('')
/** #15 拍照识别确认：识别中 → 确认面板；确认后的文本进入「草稿」并回填行编辑器 */
const recogOpen = ref(false)
const recogBusy = ref(false)
const recognition = ref<Recognition | null>(null)
const recogDraft = ref<{ text: string; recogId: string; at: string } | null>(null)
/** 第 1 层微课（02 §4.9）：内容由服务端下发，这里只保存在内存里渲染。 */
const microOpen = ref(false)
const microLesson = ref<LessonView | null>(null)
/** 迁移题子作答的父作答 state：子作答完成后用「回到本题完成页」恢复（mock；真接口由服务端返回父 state）。 */
const transferParent = ref<AttemptState | null>(null)

// ---- #46 严格测验模式（11 §5.2/5.3）----
/** 说明页「开始」后才进入作答；刷新时用 sessionStorage 记住本 tab 已开始（契约没有 exam.started 字段）。 */
const EXAM_STARTED_KEY = 'pg.exam.started:'
const examStarted = ref(false)
const examStartBusy = ref(false)
const fullscreenExitVisible = ref(false)
const fullscreenNote = ref('')
const leaveWarningVisible = ref(false)
const leaveWarningCount = ref(0)
const examRefreshing = ref(false)
const nowTick = ref(Date.now())
const serverOffset = ref(0)
let examClockTimer: ReturnType<typeof setInterval> | null = null
let lockedPollTimer: ReturnType<typeof setInterval> | null = null
let disposeExamMock: (() => void) | null = null

/** 只读服务端 state：是否测验模式 / 是否锁定 / 切出次数与阈值 / 截止时间。 */
const strictExam = computed(() => isStrictExam(state.value))
const strictExamActive = computed(() => strictExam.value && examStarted.value && !isCompleted.value)
const examIsLocked = computed(() => strictExam.value && examLocked(state.value))
const maxWarnings = computed(() => examMaxWarnings(state.value))
const warnings = computed(() => examWarnings(state.value))
const deadlineMs = computed(() => examDeadlineMs(state.value))
const remaining = computed(() => remainingMs(deadlineMs.value, serverOffset.value, nowTick.value))
const countdownText = computed(() => formatCountdown(remaining.value))
const timeUp = computed(() => isExamTimeUp(remaining.value))
const watermarkContent = computed(() =>
  // 水印时间用「客户端现在 + 服务端时钟偏移」：截图外传时的溯源时间与服务端计时一致（11 §5.3/§7）。
  watermarkText(examWatermarkCode(state.value, sessionMe.value?.anonCode ?? null), new Date(nowTick.value + serverOffset.value)),
)
/** 测验模式求助：04 §7 默认关闭，可只开概念；mock 用 exam.allowedHelp 开关，真实以服务端 state 为准。 */
const strictHelpMode = computed(() => examAllowedHelp(state.value))
const strictHelpOff = computed(() => strictExam.value && strictHelpMode.value === 'off')
/** 作答中拦截复制/剪切/粘贴/右键（说明页不拦；完成页解除）。 */
const clipboardBlocked = computed(() => shouldBlockClipboard(state.value.mode, examStarted.value) && !isCompleted.value)

// ---- #27 诚信事件 SDK / IndexedDB 草稿 / 离线提示 ----
const integrity = initIntegrity()
const draftStore = getDraftStore()
/** 恢复提示：def（L1）| line_statement（L3 行）| null */
const restoredDraft = ref<'def' | 'line_statement' | null>(null)
const l1Initial = ref('')
const lineDraftInitial = ref({ statement: '', justification: '' })
const offlineRetrying = ref(false)

const currentLayer = computed(() => state.value.currentLayer)
const lines = computed(() => state.value.steps?.lines ?? [])
const notes = computed(() => state.value.notes ?? [])
/** 实际渲染的批注：state.notes（服务端）+ 本次会话 check_line 返回的 res.note，按 noteId 去重并去掉已关闭的。 */
const visibleNotes = computed(() =>
  filterDismissedNotes(mergeNotes(notes.value, sessionLineNotes.value), dismissedNoteIds.value),
)
const asideNotes = computed(() =>
  visibleNotes.value
    .filter((n) => n.kind === 'annotation' || n.kind === 'hint' || n.kind === 'concept' || n.kind === 'refusal' || n.kind === 'student')
    .slice(-8)
    .reverse(),
)
const isCompleted = computed(() => state.value.status === 'completed')
// 契约有软删 deleteLine，行号会不连续：下一个行号取 max(n)+1，不用数组长度（PR #90 复审建议）。
const nextLineNo = computed(() => nextLineNoOf(lines.value))
const isTransferAttempt = computed(() => state.value.kind === 'transfer')
const layerTitle = computed(() => state.value.layers.find((l) => l.layer === currentLayer.value)?.title ?? '')
const layerTask = computed(() => {
  if (currentLayer.value === 'L1') return state.value.def?.task ?? ''
  if (currentLayer.value === 'L2') return state.value.frame?.task ?? ''
  if (currentLayer.value === 'L3') return '每次写一行：结论 + 依据。顺序由你决定。'
  return ''
})
const modeClass = computed(() => 'pg-practice--' + mode.value)
const strictClass = computed(() => ({ 'pg-practice--strict': strictExamActive.value }))
/** #27：打开行编辑器时的初始值 —— 识别确认的文本优先（#15 行为），否则用本机未提交草稿。 */
const editorInitialStatement = computed(() => recogDraft.value?.text ?? lineDraftInitial.value.statement)
const editorInitialJustification = computed(() => lineDraftInitial.value.justification)

// #27：事件归属随作答/切层/状态更新（currentLayer 声明之后再调用）
function syncIntegrityContext(): void {
  integrity.setContext({
    attemptId: state.value.attemptId,
    layer: state.value.currentLayer,
    mode: state.value.mode,
    problemId: state.value.problem.problemId,
  })
}
syncIntegrityContext()
watch(
  [() => state.value.attemptId, currentLayer, () => state.value.mode, () => state.value.status],
  syncIntegrityContext,
)

/** 打开做题页时恢复本机草稿（#27）：只恢复当前 attempt/layer 的必要字段。 */
async function restoreDrafts(): Promise<void> {
  const attemptId = state.value.attemptId
  if (!attemptId) return
  if (currentLayer.value === 'L1') {
    const text = await draftStore.loadDraft(attemptId, 'def')
    if (text) {
      l1Initial.value = text
      restoredDraft.value = 'def'
    }
    return
  }
  if (currentLayer.value === 'L3') {
    const statement = await draftStore.loadDraft(attemptId, 'line_statement')
    const justification = await draftStore.loadDraft(attemptId, 'line_justification')
    if (statement || justification) {
      lineDraftInitial.value = { statement: statement ?? '', justification: justification ?? '' }
      restoredDraft.value = 'line_statement'
    }
  }
}

/** L1 输入 → 500ms 防抖写 IndexedDB（只存 text/updatedAt）。 */
function handleLayer1Input(value: string): void {
  void draftStore.saveDraft(state.value.attemptId, 'def', value)
}

/** L3 行编辑器输入 → 防抖写「这一行 / 依据」两个草稿。 */
function handleEditorDraft(d: { statement: string; justification: string }): void {
  void draftStore.saveDraft(state.value.attemptId, 'line_statement', d.statement)
  void draftStore.saveDraft(state.value.attemptId, 'line_justification', d.justification)
}

async function handleOfflineRetry(): Promise<void> {
  offlineRetrying.value = true
  try {
    await integrity.flush('manual')
  } finally {
    offlineRetrying.value = false
  }
}

onUnload(() => {
  cleanupExam()
  draftStore.flush()
  void integrity.flushBeacon()
})

function show(msg: string) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 2400)
}

/** 开发期 mock 开关（PR #87 审计）：生产构建不允许用 ?mock= 切到假状态。 */
const mockEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK === '1'

/**
 * 从 URL hash 读取 mock 状态（H5 截图/演示用）：
 * 例如 #/pages/practice/index?mock=l3-active。
 * onLoad 收到的 options 在部分 H5 路由模式下只含 hash 前的查询，这里补一条兜底。
 * 用 parseMockKey（Object.hasOwn）校验：`in` 会命中 Object.prototype（constructor 等）→ 白屏。
 */
/** #46 e2e/演示：?exam=1 等价于 mock 的测验状态（仅 mock 构建；hash 查询兜底）。 */
function examFlagFromHash(): boolean {
  if (!mockEnabled || typeof window === 'undefined') return false
  const hash = window.location.hash
  const i = hash.indexOf('?')
  if (i === -1) return false
  return new URLSearchParams(hash.slice(i + 1)).get('exam') === '1'
}

function mockFromHash(): MockKey | null {
  if (!mockEnabled || typeof window === 'undefined') return null
  const hash = window.location.hash
  const i = hash.indexOf('?')
  if (i === -1) return null
  return parseMockKey(new URLSearchParams(hash.slice(i + 1)).get('mock'))
}

const initialMock = mockFromHash()
if (initialMock) setMock(initialMock)

onLoad(async (q) => {
  // #46 e2e：mock 构建下安装显式的「服务端模拟」hook（window.__PG_EXAM_MOCK__），真实模式不安装。
  if (mockEnabled) ensureExamMockHook()
  // #24 真实接口开关：默认由 VITE_USE_MOCK 决定；联调/e2e 可用 ?api=real 在 mock 构建里强制真实模式。
  if (q?.api === 'real') {
    setMockMode(false)
    realMode.value = true
  }
  // #145 年龄门：登录后、同意/练习前必须先有年龄分档（null → 选择页；lt14 → 暂不开通）。
  // 未登录/字段缺失不在这里拦（unknown），以服务端写接口的 409 AGE_BAND_REQUIRED / 403 AGE_RESTRICTED 为准。
  if (!ageGatePassed(await enforceAgeGate())) return
  // 真实模式：?assignmentId= 开始/恢复作答（POST /student/assignments/{id}/attempt）；
  // ?attemptId= 断线重连（GET /attempts/{id}）。mock 模式继续走下面的演示状态。
  if (realMode.value) {
    const assignmentId = q?.assignmentId ? String(q.assignmentId) : ''
    const attemptId = q?.attemptId ? String(q.attemptId) : ''
    if (assignmentId || attemptId) {
      await run(async () => {
        const next = assignmentId ? await startAttempt(assignmentId) : await getAttempt(attemptId)
        apply(next)
        return next
      })
      void restoreDrafts()
      return
    }
  }
  // 证明本「稍后重做」：服务端返回的新作答 state 通过 store 跨页交接（mock；真接口按 assignmentId 创建）。
  const pending = takePendingAttempt()
  if (pending) {
    transferParent.value = null
    apply(pending)
    void restoreDrafts()
    return
  }
  if (realMode.value || !mockEnabled) {
    void restoreDrafts()
    return
  }
  const k = parseMockKey(q?.mock) ?? initialMock
  if (k) setMock(k)
  else if (mockEnabled && (String(q?.exam ?? '') === '1' || examFlagFromHash())) setMock('exam-active')
  void restoreDrafts()
})

// ---- #46 严格测验逻辑：只渲染服务端 state，不做本地计数/锁定判定 ----

function examStartedKey(attemptId: string): string {
  return EXAM_STARTED_KEY + attemptId
}
function readExamStartedMarker(attemptId: string): boolean {
  if (typeof window === 'undefined' || !attemptId) return false
  try {
    return window.sessionStorage.getItem(examStartedKey(attemptId)) === '1'
  } catch {
    return false
  }
}
function writeExamStartedMarker(attemptId: string): void {
  if (typeof window === 'undefined' || !attemptId) return
  try {
    window.sessionStorage.setItem(examStartedKey(attemptId), '1')
  } catch {
    /* 隐私模式/存储禁用时忽略：刷新后重新显示说明页，不阻塞作答 */
  }
}

/** 从服务端 state 同步本地展示状态（examStarted 只看「本 tab 已点开始」或服务端已锁定/完成）。 */
function syncExamFromState(): void {
  if (strictExam.value) {
    if (!examStarted.value) {
      examStarted.value = readExamStartedMarker(state.value.attemptId) || examLocked(state.value) || isCompleted.value
    }
    serverOffset.value = serverOffsetMs(state.value)
    nowTick.value = Date.now()
    startExamClock()
  } else {
    examStarted.value = false
    serverOffset.value = 0
  }
  syncClipboardBlock()
}
function startExamClock(): void {
  if (examClockTimer !== null) return
  examClockTimer = setInterval(() => {
    nowTick.value = Date.now()
  }, 1000)
}
function stopExamClock(): void {
  if (examClockTimer !== null) {
    clearInterval(examClockTimer)
    examClockTimer = null
  }
}
function syncClipboardBlock(): void {
  integrity.setClipboardBlocked(clipboardBlocked.value)
}
/** 说明页「开始」：手势内请求全屏（不支持则记录 unsupported，进入水印模式）。 */
async function startExam(): Promise<void> {
  if (examStartBusy.value || !strictExam.value) return
  examStartBusy.value = true
  writeExamStartedMarker(state.value.attemptId)
  examStarted.value = true
  fullscreenExitVisible.value = false
  try {
    const result = await requestExamFullscreen(
      typeof document === 'undefined' ? null : document,
      typeof navigator === 'undefined' ? null : navigator.userAgent,
    )
    if (result === 'unsupported') {
      fullscreenNote.value = '当前浏览器不支持全屏（如 iPhone Safari），已启用水印模式。'
      integrity.report('integ.fullscreen', { state: 'unsupported' })
    } else if (result === 'denied') {
      fullscreenNote.value = '全屏请求被拒绝，已启用水印模式；可点「回到全屏」再试。'
      integrity.report('integ.fullscreen', { state: 'denied' })
    } else {
      fullscreenNote.value = ''
    }
  } finally {
    examStartBusy.value = false
    nowTick.value = Date.now()
    syncClipboardBlock()
  }
}
async function returnFullscreen(): Promise<void> {
  const result = await requestExamFullscreen(
    typeof document === 'undefined' ? null : document,
    typeof navigator === 'undefined' ? null : navigator.userAgent,
  )
  if (result === 'enter') fullscreenExitVisible.value = false
}
/** 教师解锁/服务端状态更新：真实模式轮询 GET /attempts/{id}；mock 用 __PG_EXAM_MOCK__.unlock()。 */
async function refreshExamState(): Promise<void> {
  if (examRefreshing.value) return
  examRefreshing.value = true
  try {
    if (realMode.value) {
      const next = await getAttempt(state.value.attemptId)
      apply(next)
      serverOffset.value = serverOffsetMs(next)
    }
  } catch {
    show('暂时无法获取最新状态，请稍后再试')
  } finally {
    examRefreshing.value = false
  }
}
function startLockedPolling(): void {
  if (lockedPollTimer !== null || !realMode.value) return
  lockedPollTimer = setInterval(() => {
    void refreshExamState()
  }, 5000)
}
function stopLockedPolling(): void {
  if (lockedPollTimer !== null) {
    clearInterval(lockedPollTimer)
    lockedPollTimer = null
  }
}
function onFullscreenChange(): void {
  if (!strictExam.value || !examStarted.value || isCompleted.value) return
  fullscreenExitVisible.value = !isFullscreen(typeof document === 'undefined' ? null : document)
}
/** 回到前台：真实模式刷新一次 state，让服务端把切出次数/锁定写回来（前端不自行累加）。 */
function onExamVisibilityChange(): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  if (!strictExamActive.value) return
  nowTick.value = Date.now()
  if (realMode.value) void refreshExamState()
}
function ensureExamMockHook(): void {
  if (!mockEnabled || disposeExamMock) return
  disposeExamMock = installExamMockHook(
    () => state.value,
    (next) => apply(next),
  )
}
function cleanupExam(): void {
  stopExamClock()
  stopLockedPolling()
  integrity.setClipboardBlocked(false)
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    document.removeEventListener('visibilitychange', onExamVisibilityChange)
  }
  if (disposeExamMock) {
    disposeExamMock()
    disposeExamMock = null
  }
}

watch(
  () => [state.value.attemptId, state.value.mode, state.value.status, state.value.serverTime] as const,
  () => {
    syncExamFromState()
    if (examIsLocked.value) startLockedPolling()
    else stopLockedPolling()
  },
  { immediate: true },
)
watch(
  () => [state.value.exam?.deadlineAt, state.value.serverTime] as const,
  () => {
    serverOffset.value = serverOffsetMs(state.value)
  },
)
watch(
  () => state.value.integrity?.warnings,
  (next, previous) => {
    if (!strictExam.value) return
    if (shouldShowLeaveWarning(previous ?? 0, next ?? 0, examLocked(state.value), maxWarnings.value)) {
      leaveWarningCount.value = next ?? 0
      leaveWarningVisible.value = true
    }
    if (examLocked(state.value)) leaveWarningVisible.value = false
  },
)
watch(examIsLocked, (locked) => {
  if (locked) {
    leaveWarningVisible.value = false
    startLockedPolling()
  } else {
    stopLockedPolling()
  }
})
watch(strictExam, (isExam) => {
  if (isExam) startExamClock()
  else stopExamClock()
})
watch(clipboardBlocked, (blocked) => {
  integrity.setClipboardBlocked(blocked)
})

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('visibilitychange', onExamVisibilityChange)
  }
})
onUnmounted(cleanupExam)

function onSwitchMock(k: MockKey) {
  setMock(k)
  resetLineNoteState()
  hintPreview.value = null
  helpNote.value = null
  lastHelp.value = { intent: 'concept', text: '' }
  editorOpen.value = false
  helpOpen.value = false
  restoredDraft.value = null
  l1Initial.value = ''
  lineDraftInitial.value = { statement: '', justification: '' }
  void restoreDrafts()
}

function switchLayer(_layer: LayerId) {
  layersOpen.value = false
  show('P0 层跳转由服务端 state 决定，这里不自己改层')
}

async function handleSubmit(text: string) {
  const layer = currentLayer.value
  const attemptId = state.value.attemptId
  const fn = layer === 'L1' ? submitDef : submitFramework
  const next = await run(() => fn(state.value, text))
  if (!next) return
  apply(next)
  // #27：提交成功后清除本机草稿（避免下次打开又恢复旧内容）。
  if (layer === 'L1') {
    l1Initial.value = ''
    await draftStore.clearDraft(attemptId, 'def')
    restoredDraft.value = null
  }
}

/**
 * 第 1 层「看不懂」→ 取微课（GET /lesson/{conceptId}）并打开分步微课（02 §4.9）；
 * 第 2 层「看通用骨架」→ 契约的 POST /framework/template，由服务端返回 templateShown=true 的 state。
 */
async function handleLesson() {
  if (currentLayer.value === 'L1') {
    const lesson = await run(() => fetchLesson(state.value))
    if (!lesson) return
    microLesson.value = lesson
    microOpen.value = true
    return
  }
  if (currentLayer.value === 'L2') {
    const next = await run(() => viewFrameTemplate(state.value))
    if (next) apply(next)
    return
  }
  show('本层的讲解入口在 #24 接入')
}

function closeMicro() {
  microOpen.value = false
}

/** 跳层是独立操作（POST /layers/{L}/skip）：不把「已掌握，跳过」当文本提交，也不写 def/frame.last。 */
async function handleSkip() {
  const layer = currentLayer.value
  if (layer !== 'L1' && layer !== 'L2' && layer !== 'L4' && layer !== 'L5') return
  const attemptId = state.value.attemptId
  const next = await run(() => skipLayer(state.value, layer))
  if (!next) return
  apply(next)
  if (layer === 'L1') {
    l1Initial.value = ''
    await draftStore.clearDraft(attemptId, 'def')
    restoredDraft.value = null
  }
}

/** 第 4 层：提交一道自检题；判定与追问都来自服务端返回的 state。 */
async function handleSelfcheckSubmit(itemId: string, text: string) {
  const next = await run(() => submitSelfcheck(state.value, itemId, text))
  if (next) apply(next)
}

/** 第 5 层：开始迁移题（服务端创建子作答，返回 kind=transfer 的子作答 state）。 */
async function handleStartTransfer() {
  const parent = state.value
  const next = await run(() => startTransfer(parent))
  if (!next) return
  transferParent.value = parent
  apply(next)
}

/** 迁移题子作答的行编辑：加入 / 改写 / 删除一行（归类、批注、canFinish 都由服务端返回的 state 决定）。 */
type TransferDraft = { statement: string; justification: string; provenance: InputProvenance }

function toLineDraft(draft: TransferDraft): LineDraft {
  return {
    statement: draft.statement,
    justification: draft.justification,
    input: { provenance: draft.provenance, draftId: 'mock-' + Date.now() },
  }
}

async function handleAddTransferLine(draft: TransferDraft) {
  const next = await run(() => addTransferLine(state.value, toLineDraft(draft)))
  if (next) apply(next)
}

async function handleEditTransferLine(lineId: string, draft: TransferDraft) {
  const next = await run(() => editTransferLine(state.value, lineId, toLineDraft(draft)))
  if (next) apply(next)
}

async function handleDeleteTransferLine(lineId: string) {
  const next = await run(() => deleteTransferLine(state.value, lineId))
  if (next) apply(next)
}

/** 迁移题「写完了」：mock reducer 判定行数/依据/关键步骤，达标才 completed。 */
async function handleFinishTransfer() {
  const next = await run(() => finishTransfer(state.value))
  if (next) apply(next)
}

/** 迁移题完成 → 回到本题完成页（mock：服务端推进父作答 L5→L6；已完成的父作答原样返回）。 */
async function handleBackToParent() {
  const parent = transferParent.value
  transferParent.value = null
  if (!parent) {
    uni.navigateTo({ url: '/pages/practice/index?mock=completed' })
    return
  }
  const next = await run(() => completeTransferParent(parent))
  apply(next ?? parent)
}

/** 完成页「再做一道迁移题」：手动发起一次迁移题子作答。 */
async function handleMakeTransfer() {
  await handleStartTransfer()
}

/** 第 6 层：提交五问总结 → 完成页。 */
async function handleSubmitSummary(answers: string[]) {
  const next = await run(() => submitSummary(state.value, answers))
  if (next) apply(next)
}

/** 完成页「加入证明本」/ 首页「证明本」：打开证明本页（mock 列表见 fetchNotebook）。 */
function goProofbook() {
  uni.navigateTo({ url: '/pages/proofbook/index' })
}

async function handleAddLine(draft: LineDraft) {
  const attemptId = state.value.attemptId
  const next = await run(() => addLine(state.value, draft))
  if (next) {
    apply(next)
    editorOpen.value = false
    // #27：加行成功后清除这一行的本机草稿（失败时保留，便于重试）。
    lineDraftInitial.value = { statement: '', justification: '' }
    restoredDraft.value = null
    await Promise.all([
      draftStore.clearDraft(attemptId, 'line_statement'),
      draftStore.clearDraft(attemptId, 'line_justification'),
    ])
  } else {
    // 失败不关编辑器：本地草稿与 draftId 保留，重试复用（PR #90 复审建议）。
    show(error.value || '加入证明失败，请重试；你写的内容还在编辑器里')
  }
}

async function handleFinish() {
  const next = await run(() => finishSteps(state.value))
  if (next) apply(next)
}

function openHelp() {
  // #46 测验模式：布置关闭求助时只提示；只开概念时抽屉（HelpDrawer 在 test 模式已只保留概念）。
  if (strictHelpOff.value) {
    show('测验模式已关闭提示；如卡住请联系老师。')
    return
  }
  helpOpen.value = true
}

function handleHelpOpen(v: boolean) {
  helpOpen.value = v
  if (!v) helpNote.value = null
}

/**
 * 三种意图 / 自由提问的统一出口（#16；PR #91 审计 1 修复）：
 * 1) 有 preview（H2 起，或 blocked preview）→ 抽屉收起，页面弹提示预览卡；
 * 2) 有 note（H0/H1 免费提示、概念解释、施压拒绝、off_topic）→ 抽屉里展示 note 卡；
 * 3) 两者都没有 → 才 toast。
 * 只搬运服务端结果，不判定门槛与预算；不再从 state.notes 兜底取 note（真服务端 toAttemptState 的 notes 恒为空）。
 */
async function runHelp(intent: HelpIntent, text = '') {
  const res = await run(() => requestHelp(state.value, intent, text))
  if (!res) {
    // run() 会把错误放进 store.error；不再静默失败（PR #91 审计建议）
    show(error.value ?? '求助暂时不可用，请稍后再试')
    return
  }
  apply(res.state)
  lastHelp.value = { intent, text }

  // 预览卡不依赖抽屉是否打开（点「卡住了」后抽屉会收起）
  if (res.preview) {
    helpNote.value = null
    hintPreview.value = res.preview
    helpOpen.value = false
    return
  }

  const routed = res.routed
  const note = res.note ?? null

  // #151 / #141：行检查的批注显示位置是行内（01 §4），不依赖抽屉是否还开着。
  // 先把 res.note 记到本次会话的本地 overlay（与 state.notes 去重合并后挂到对应 lineId 下方）；
  // 即使请求途中抽屉被关掉，批注也不会像从前的 check_line 分支那样只 toast 不落位。
  if (note && routed === 'check_line') {
    const lineNote = parseNote(note)
    if (lineNote) sessionLineNotes.value = mergeNotes(sessionLineNotes.value, [lineNote])
    hintPreview.value = null
    helpNote.value = null
    helpOpen.value = false
    show('批注已放到这一行下方')
    return
  }

  // 请求在途时抽屉已被关掉（正常关闭在 busy 时已被 HelpDrawer 拦住，这里是兜底）：
  // 只更新 state，不设置抽屉 note，避免重开抽屉时冒出陈旧卡片（PR #91 审计 4）。
  if (!helpOpen.value) {
    helpNote.value = null
    return
  }

  if (note) {
    hintPreview.value = null
    // H0/H1 提示、概念解释、施压拒绝、off_topic：01 §4 规定显示在抽屉里
    helpNote.value = note
    return
  }

  hintPreview.value = null
  helpNote.value = null
  helpOpen.value = false
  show(routed === 'concept' ? '概念解释暂不可用，请稍后再试' : '暂时没有新的内容，稍后再试')
}

function handleIntent(intent: HelpIntent) {
  void runHelp(intent)
}

/** 自由提问：契约 intent=free（06 §3.4），服务端据此跑施压/注入规则（B 的 #29）。 */
function handleSend(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    show('先写一句你卡在哪')
    return
  }
  void runHelp('free', trimmed)
}

/** 预览卡「重新获取预览」/ dwell 归零：按原意图重新 /help（不自行放开门槛）。 */
function handlePreviewRetry() {
  const { intent, text } = lastHelp.value
  hintPreview.value = null
  void runHelp(intent, text)
}

async function handleClaim() {
  const preview = hintPreview.value
  if (!preview) return
  const next = await run(() => claimHint(state.value, preview))
  if (!next) {
    // 领取失败（真实接口下 409 HINT_PREVIEW_EXPIRED / HINT_NOT_READY）：清掉旧卡并提示，避免继续点过期 token
    hintPreview.value = null
    show(error.value ?? '领取失败，请重新获取预览')
    return
  }
  apply(next)
  hintPreview.value = null
  const wait = typeof next.help.waitSec === 'number' && next.help.waitSec > 0 ? next.help.waitSec : 0
  show('已领取；下一级要等你再写一行' + (wait > 0 ? '并停留 ' + wait + ' 秒' : '') + '后才能继续')
}

function handleDecline() {
  hintPreview.value = null
}

/** 软着陆出路（01 §4.4；文案与抽屉/预览卡共用 hintPreviewCopy，页面只显示选择，不实现微课跳转）。 */
function handleSoftLanding(action: string) {
  helpOpen.value = false
  helpNote.value = null
  hintPreview.value = null
  show('已选「' + softLandingLabel(action) + '」；微课/下一题入口在 #26 接入')
}

/** #151：关闭一条批注（只影响本页展示，不回写服务端；刷新后以服务端 state 为准）。 */
function handleDismissNote(noteId: string): void {
  if (!noteId) return
  dismissedNoteIds.value = new Set([...dismissedNoteIds.value, noteId])
}

/** 切换 mock/作答时清掉本地行批注（避免把上一份状态的行批注带到新状态上）。 */
function resetLineNoteState(): void {
  sessionLineNotes.value = []
  dismissedNoteIds.value = new Set()
}

// 作答切换（真实模式重连/换题）时，本地 overlay 只对当前作答有效。
watch(
  () => state.value.attemptId,
  () => resetLineNoteState(),
)

function handleInk() {
  editorOpen.value = true
  show('手写画布由 #14 提供，本轮先进入行编辑器')
}

function handleKeyboard() {
  editorOpen.value = true
}

/** #15：拍照 → mock 识别 → 确认面板（真实 /recognitions/photo 接口在 #25 接入） */
async function startPhotoRecognition() {
  if (recogBusy.value) return
  // 测验模式下拍照禁用（03 §3.3）
  if (state.value.integrity.mode === 'test') {
    show('测验模式下拍照不可用')
    return
  }
  recogOpen.value = true
  recogBusy.value = true
  recognition.value = null
  const result = await run(() => recognizeInk('mock-photo'))
  recogBusy.value = false
  if (!result) {
    recogOpen.value = false
    show('识别暂不可用，请用键盘')
    return
  }
  recognition.value = result
}

function handlePhoto() {
  void startPhotoRecognition()
}

/** 「重新识别」：重新跑一次 mock 识别（面板留在原处，识别中再次显示加载态） */
async function handleRecogRewrite() {
  recogBusy.value = true
  recognition.value = null
  const result = await run(() => recognizeInk('mock-photo'))
  recogBusy.value = false
  if (!result) {
    recogOpen.value = false
    show('识别暂不可用，请用键盘')
    return
  }
  recognition.value = result
}

/** 确认加入：识别结果进入草稿（mock 下页面能看到结果文本），并回填行编辑器 */
function handleRecogConfirm(text: string) {
  const recogId = recognition.value?.recogId ?? ''
  recogOpen.value = false
  recognition.value = null
  recogDraft.value = { text, recogId, at: new Date().toISOString() }
  show('识别结果已放入草稿，继续写这一行')
}

/** 放弃重写：关掉面板，不采用这次识别 */
function handleRecogDiscard() {
  recogOpen.value = false
  recognition.value = null
  show('已放弃这次识别，可以重新写')
}

function closeRecogLoading() {
  recogOpen.value = false
  recognition.value = null
}

function handleBack() {
  uni.navigateBack()
}

function backHome() {
  uni.redirectTo({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="pg-page pg-practice" :class="[modeClass, strictClass]">
    <TopBar
      :title="state.problem.title"
      :current-layer="currentLayer"
      :layers="state.layers"
      @back="handleBack"
      @open-layers="layersOpen = true"
    />

    <!-- #27 离线提示条：正常文档流 + sticky，不覆盖 44px 操作区/BottomDock -->
    <OfflineBar :retrying="offlineRetrying" @retry="handleOfflineRetry" />

    <!-- #46 测验模式：倒计时以服务端 state.serverTime/截止时间为准；到点不在本地结束 -->
    <view v-if="strictExamActive && !examIsLocked" class="pg-exambar" data-testid="exam-bar">
      <text class="pg-exambar__label">限时测验 · 只读计时</text>
      <text class="pg-exambar__time pg-mono" data-testid="exam-countdown">
        {{ timeUp ? '已到时间，等待服务端提交…' : countdownText }}
      </text>
      <text v-if="fullscreenNote" class="pg-exambar__note pg-small" data-testid="exam-fullscreen-note">{{ fullscreenNote }}</text>
    </view>
    <view v-if="error" class="pg-practice__error pg-small">
      <text class="pg-practice__errortext">{{ error }}</text>
      <button class="pg-practice__errorbtn pg-small" @tap="backHome">回首页</button>
    </view>

    <LayerNav
      v-if="mode === 'tablet'"
      :layers="state.layers"
      :current="currentLayer"
      @select="switchLayer"
    />

    <view class="pg-practice__shell">
      <view v-if="mode === 'desktop'" class="pg-practice__rail">
        <LayerNav :layers="state.layers" :current="currentLayer" vertical @select="switchLayer" />
        <BudgetBar :budget="state.budget" />
      </view>

      <view class="pg-practice__main">
        <ProblemCard :problem="state.problem" />

        <view class="pg-practice__content">
          <!-- #27 草稿恢复提示：重新打开时告诉学生内容来自本机未提交草稿 -->
          <view v-if="restoredDraft" class="pg-draftnotice" data-testid="draft-restored" role="status">
            <text class="pg-draftnotice__text pg-small">已恢复上次未提交的草稿</text>
            <button class="pg-draftnotice__btn pg-small" role="button" data-testid="draft-restored-dismiss" @tap="restoredDraft = null">
              知道了
            </button>
          </view>

          <view class="pg-practice__head">
            <text class="pg-practice__layertitle">{{ layerTitle }}</text>
            <!-- #11：L1/L2 的任务说明由表单用 MathText 渲染，这里不再显示纯文本（避免露出 LaTeX 源码）。 -->
            <text
              v-if="layerTask && currentLayer !== 'L1' && currentLayer !== 'L2'"
              class="pg-practice__layertask pg-small"
            >{{ layerTask }}</text>
          </view>

          <template v-if="isCompleted">
            <!-- 迁移题子作答完成：给出回到主题作答完成页 / 加入证明本的出口（01 §L5） -->
            <view v-if="isTransferAttempt" class="pg-practice__done pg-sheet" data-testid="transfer-complete-card">
              <text class="pg-practice__donetitle" data-testid="transfer-complete-title">迁移题完成</text>
              <text class="pg-practice__donebody pg-small">
                这道迁移题独立完成：{{ state.problem.title }}。你把 ε-N 的骨架用到了 ε-δ 上。
              </text>
              <text class="pg-practice__donebody pg-small">
                自己写出 {{ state.budget.keysOwn }} / {{ state.budget.keysTotal }} 个关键步骤；独立度
                {{ state.completion?.independence ?? '-' }}。
              </text>
              <text class="pg-practice__donebody pg-small">
                mathlib4 对照（只列定理名）：{{ state.completion?.leanCard?.theorems?.join('、') ?? '—' }}
              </text>
              <view class="pg-practice__donerow">
                <button class="pg-practice__btn" role="button" data-testid="back-to-parent" @tap="handleBackToParent">回到本题完成页</button>
                <button
                  class="pg-practice__btn pg-practice__btn--primary"
                  role="button"
                  data-testid="transfer-add-to-notebook"
                  @tap="goProofbook"
                >
                  加入证明本
                </button>
              </view>
            </view>

            <view v-else class="pg-practice__done pg-sheet" data-testid="completion-card">
              <text class="pg-practice__donetitle" data-testid="completion-title">本题完成</text>
              <text class="pg-practice__donebody pg-small">
                自己写出 {{ state.budget.keysOwn }} / {{ state.budget.keysTotal }} 个关键步骤；
                透露 {{ state.budget.revealUsed }} / {{ state.budget.revealMax }}。
                独立度 {{ state.completion?.independence ?? '-' }}。
              </text>
              <text class="pg-practice__donebody pg-small">mathlib4 对照（只列定理名）：{{ state.completion?.leanCard?.theorems?.join('、') ?? '—' }}</text>
              <text v-if="state.completion?.leanCard?.steps?.length" class="pg-practice__donebody pg-small">
                你写出的关键步骤：{{ state.completion?.leanCard?.steps?.map((s) => s.label).join('、') }}
              </text>
              <text class="pg-practice__donebody pg-small">P0 只核对关键步骤齐全，未校验逻辑顺序。</text>
              <view class="pg-practice__donerow">
                <button class="pg-practice__btn" role="button" data-testid="back-home" @tap="backHome">回首页</button>
                <button
                  class="pg-practice__btn pg-practice__btn--primary"
                  role="button"
                  data-testid="add-to-notebook"
                  @tap="goProofbook"
                >
                  加入证明本
                </button>
                <button
                  class="pg-practice__btn"
                  role="button"
                  data-testid="make-transfer"
                  @tap="handleMakeTransfer"
                >
                  再做一道迁移题
                </button>
              </view>
            </view>
          </template>

          <TransferAttempt
            v-else-if="isTransferAttempt"
            :problem="state.problem"
            :lines="lines"
            :notes="visibleNotes"
            :can-finish="Boolean(state.steps?.canFinish)"
            :busy="busy"
            @add-line="handleAddTransferLine"
            @edit-line="handleEditTransferLine"
            @delete-line="handleDeleteTransferLine"
            @finish="handleFinishTransfer"
            @dismiss-note="handleDismissNote"
          />

          <Layer1Form
            v-else-if="currentLayer === 'L1'"
            layer="L1"
            :view="state.def ?? {}"
            :busy="busy"
            :initial-text="l1Initial"
            @submit="handleSubmit"
            @update:text="handleLayer1Input"
            @lesson="handleLesson"
            @skip="handleSkip"
          />

          <Layer2Form
            v-else-if="currentLayer === 'L2'"
            layer="L2"
            :view="state.frame ?? {}"
            :busy="busy"
            @submit="handleSubmit"
            @lesson="handleLesson"
            @skip="handleSkip"
          />

          <template v-else-if="currentLayer === 'L3'">
            <!-- #15：拍照识别确认后的结果先作为「这一行」的草稿显示，学生确认/再改后才提交 -->
            <view v-if="recogDraft" class="pg-practice__draft pg-sheet" :data-draft-text="recogDraft.text">
              <view class="pg-practice__drafthead">
                <text class="pg-practice__drafttitle">📷 识别结果（已确认）</text>
                <text class="pg-practice__draftmeta pg-small">已放入这一行草稿</text>
              </view>
              <view class="pg-practice__drafttext">
                <MathText :text="recogDraft.text" block />
              </view>
              <view class="pg-practice__draftrow">
                <button class="pg-practice__btn pg-small pg-practice__draftbtn--continue" @tap="editorOpen = true">用键盘继续改</button>
                <button class="pg-practice__btn pg-small pg-practice__draftbtn--clear" @tap="recogDraft = null">清除草稿</button>
              </view>
            </view>
            <ProofLineList
              :lines="lines"
              :notes="visibleNotes"
              :busy="busy"
              @write-next="editorOpen = true"
              @dismiss-note="handleDismissNote"
            />
            <view class="pg-practice__finishrow">
              <button
                class="pg-practice__btn pg-practice__btn--primary"
                role="button"
                data-testid="finish-steps"
                :disabled="!state.steps?.canFinish || busy"
                @tap="handleFinish"
              >
                写完了
              </button>
            </view>
          </template>

          <SelfcheckForm
            v-else-if="currentLayer === 'L4'"
            :view="state.selfcheck ?? null"
            :lines="lines"
            :busy="busy"
            @submit="handleSelfcheckSubmit"
            @skip="handleSkip"
          />

          <TransferForm
            v-else-if="currentLayer === 'L5'"
            :view="state.transfer ?? null"
            :busy="busy"
            @start="handleStartTransfer"
            @skip="handleSkip"
          />

          <SummaryForm v-else-if="currentLayer === 'L6'" :view="state.summary ?? null" :busy="busy" @submit="handleSubmitSummary" />

          <view v-else class="pg-practice__placeholder pg-sheet">
            <text class="pg-practice__layertitle">{{ currentLayer }} · {{ layerTitle }}</text>
            <text class="pg-practice__layertask pg-small">这一层暂未接入。</text>
          </view>
        </view>
      </view>

      <view v-if="mode !== 'mobile'" class="pg-practice__aside">
        <text class="pg-practice__asidetitle">页边</text>
        <view
          v-for="n in asideNotes"
          :key="n.noteId"
          class="pg-practice__note pg-sheet"
          :class="'pg-practice__note--' + n.kind"
          role="note"
          :aria-label="n.who + '：' + n.text"
        >
          <view class="pg-practice__notehead">
            <text class="pg-practice__notewho pg-small">{{ n.who }}</text>
            <text
              v-if="formatNoteTime(n.at)"
              class="pg-practice__notetime pg-small"
              data-testid="aside-note-time"
            >{{ formatNoteTime(n.at) }}</text>
            <button
              class="pg-practice__notedismiss"
              role="button"
              aria-label="关闭这条批注"
              data-testid="aside-note-dismiss"
              :data-note-id="n.noteId"
              @tap.stop="handleDismissNote(n.noteId)"
            >×</button>
          </view>
          <text class="pg-practice__notetext pg-small">{{ n.text }}</text>
        </view>
        <text v-if="asideNotes.length === 0" class="pg-practice__empty pg-small">还没有批注。写完一行，红笔会出现在这一行旁边。</text>
        <view class="pg-practice__asidehelp">
          <button
            class="pg-practice__btn pg-small"
            :class="{ 'pg-practice__btn--disabled': strictHelpOff }"
            :disabled="strictHelpOff"
            :aria-disabled="strictHelpOff ? 'true' : undefined"
            :data-testid="strictExam ? 'exam-help-aside' : undefined"
            @tap="openHelp"
          >求助</button>
        </view>
      </view>
    </view>

    <view v-if="mode === 'mobile'" class="pg-practice__dockwrap">
      <BudgetBar :budget="state.budget" />
      <BottomDock
        :help-busy="busy"
        :photo-disabled="strictExam"
        :help-disabled="strictHelpOff"
        @ink="handleInk"
        @keyboard="handleKeyboard"
        @photo="handlePhoto"
        @help="openHelp"
      />
    </view>

    <LayerSheet v-if="mode === 'mobile'" :open="layersOpen" :layers="state.layers" :current="currentLayer" @update:open="layersOpen = $event" @select="switchLayer" />
    <view v-else-if="layersOpen" class="pg-practice__mask" @tap="layersOpen = false" />

    <HelpDrawer
      :open="helpOpen"
      :help="state.help"
      :mode="state.mode"
      :busy="busy"
      :note="helpNote"
      @update:open="handleHelpOpen"
      @intent="handleIntent"
      @send="handleSend"
      @claim="handleClaim"
      @decline="handleDecline"
      @soft-landing="handleSoftLanding"
    />

    <HintPreviewCard
      v-if="hintPreview"
      :preview="hintPreview"
      :budget="state.budget"
      :busy="busy"
      @claim="handleClaim"
      @decline="handleDecline"
      @retry="handlePreviewRetry"
      @soft-landing="handleSoftLanding"
    />

    <EditorSheet
      :open="editorOpen"
      :line-no="nextLineNo"
      :initial-statement="editorInitialStatement"
      :initial-justification="editorInitialJustification"
      :busy="busy"
      @update:open="editorOpen = $event"
      @submit="handleAddLine"
      @update:draft="handleEditorDraft"
    />

    <!-- #15 拍照识别：识别中的占位（02 §4.5：超过 3 秒提示可先用键盘），拿到结果后进确认面板 -->
    <view v-if="recogOpen && !recognition" class="pg-recogmask">
      <view class="pg-recogloading pg-sheet">
        <text class="pg-recogloading__title">识别中…</text>
        <text class="pg-recogloading__hint pg-small">超过 3 秒可以先用键盘；识别结果要你确认后才会用。</text>
        <button class="pg-practice__btn" @tap="closeRecogLoading">取消</button>
      </view>
    </view>
    <RecognitionConfirm
      v-if="recognition"
      :recognition="recognition"
      :busy="recogBusy"
      @rewrite="handleRecogRewrite"
      @confirm="handleRecogConfirm"
      @discard="handleRecogDiscard"
    />
    <MicroCourse :open="microOpen" :lesson="microLesson" @close="closeMicro" />

    <!-- 真实模式不显示 mock 状态切换（#24） -->
    <MockSwitcher v-if="mockEnabled && !realMode" :model-value="mockKey" @update:model-value="onSwitchMock" />

    <!-- #46 严格测验覆盖层：水印（不遮挡交互）→ 切出警告 → 锁定遮罩 → 说明页 -->
    <ExamWatermark v-if="strictExamActive" :text="watermarkContent" />

    <view
      v-if="fullscreenExitVisible && strictExamActive && !examIsLocked"
      class="pg-fsexit"
      data-testid="exam-fullscreen-exit"
      role="alertdialog"
      aria-modal="true"
    >
      <view class="pg-fsexit__sheet">
        <text class="pg-fsexit__title">你已退出全屏</text>
        <text class="pg-fsexit__text pg-small">请回到全屏继续本场测验；退出全屏会被记录。</text>
        <button class="pg-fsexit__btn" role="button" data-testid="exam-return-fullscreen" @tap="returnFullscreen">回到全屏</button>
      </view>
    </view>

    <ExamLeaveModal
      :visible="leaveWarningVisible"
      :count="leaveWarningCount"
      :max-warnings="maxWarnings"
      @dismiss="leaveWarningVisible = false"
    />
    <ExamLockOverlay
      :visible="examIsLocked"
      :warnings="warnings"
      :max-warnings="maxWarnings"
      :retrying="examRefreshing"
      @retry="refreshExamState"
    />
    <ExamIntro
      v-if="strictExam && !examStarted && !isCompleted"
      :remaining-text="countdownText"
      :max-warnings="maxWarnings"
      :fullscreen-note="fullscreenNote"
      :busy="examStartBusy"
      @start="startExam"
    />

    <view v-if="toast" class="pg-toast pg-small" role="status" aria-live="polite">{{ toast }}</view>
  </view>
</template>

<style scoped>
.pg-practice {
  padding-bottom: 0;
}
/* #46 严格测验：题面/证明行禁止选中复制（输入框仍可编辑；粘贴由 SDK 拦截并上报） */
.pg-practice--strict :deep(.pg-problem),
.pg-practice--strict :deep(.pg-lines) {
  user-select: none;
  -webkit-user-select: none;
}
.pg-exambar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--accent-soft);
  border-bottom: 1px solid var(--accent);
  color: var(--accent);
}
.pg-exambar__label { font-size: var(--fs-small); font-weight: 600; }
.pg-exambar__time { margin-left: auto; font-size: var(--fs-body); }
.pg-exambar__note { flex-basis: 100%; color: var(--hint); }
.pg-fsexit {
  position: fixed;
  inset: 0;
  z-index: 87;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: color-mix(in srgb, var(--ink) 48%, transparent);
}
.pg-fsexit__sheet {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--sheet);
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-sheet);
}
.pg-fsexit__title { font-family: var(--font-serif); font-size: 18px; font-weight: 600; color: var(--ink); }
.pg-fsexit__text { color: var(--ink-2); line-height: 1.6; }
.pg-fsexit__btn {
  min-height: 44px;
  border-radius: var(--radius-input);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
}
.pg-practice__shell {
  display: block;
}
.pg-practice--tablet .pg-practice__shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  gap: 0;
}
.pg-practice--desktop .pg-practice__shell {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 300px;
  max-width: 1280px;
  margin: 0 auto;
}
.pg-practice__rail {
  border-right: 1px solid var(--rule);
  padding-top: var(--sp-2);
  position: sticky;
  top: 60px;
  align-self: start;
}
.pg-practice__main {
  min-width: 0;
  padding-bottom: 140px;
}
.pg-practice__error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-input);
  background: var(--margin-soft);
  color: var(--ink);
}
.pg-practice__errortext { flex: 1; }
.pg-practice__errorbtn {
  min-height: 36px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--sheet);
  color: var(--ink);
}
.pg-practice__content {
  padding: 0 var(--sp-3);
}
.pg-draftnotice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  background: var(--accent-soft);
  color: var(--ink);
}
.pg-draftnotice__text { flex: 1; min-width: 0; }
.pg-draftnotice__btn {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
}
.pg-practice__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--sp-2) 0;
}
.pg-practice__layertitle {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}
.pg-practice__layertask {
  color: var(--ink-2);
}
.pg-practice__aside {
  border-left: 1px solid var(--rule);
  padding: var(--sp-3);
  min-width: 0;
}
.pg-practice__asidetitle {
  display: block;
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.pg-practice__note {
  padding: var(--sp-2);
  margin-bottom: var(--sp-2);
  border-left: 3px solid var(--rule);
}
.pg-practice__note--annotation { border-left-color: var(--margin); background: var(--margin-soft); }
.pg-practice__note--hint { border-left-color: var(--hint); background: var(--hint-soft); }
.pg-practice__note--concept { border-left-color: var(--accent); background: var(--accent-soft); }
.pg-practice__notehead { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: 2px; }
.pg-practice__notewho { display: block; color: var(--ink-2); }
.pg-practice__notetime { color: var(--ink-2); font-family: var(--font-mono); font-size: var(--fs-mono); }
/* 关闭批注（#151）：触控目标 ≥44px，不额外撑高页边卡片。 */
.pg-practice__notedismiss {
  flex: 0 0 auto;
  margin-left: auto;
  margin-top: calc(-1 * var(--sp-2));
  margin-bottom: calc(-1 * var(--sp-2));
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 18px;
  line-height: 1;
}
.pg-practice__notedismiss::after { border: 0; }
.pg-practice__notetext { display: block; margin-top: 2px; color: var(--ink); }
.pg-practice__empty { color: var(--ink-2); }
.pg-practice__asidehelp { margin-top: var(--sp-3); }
.pg-practice__dockwrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
}
.pg-practice__dockwrap :deep(.pg-budget) {
  background: var(--paper);
  border-top: 1px solid var(--rule);
}
.pg-practice__finishrow {
  display: flex;
  justify-content: flex-end;
  padding: var(--sp-3) 0 var(--sp-2);
}
.pg-practice__btn {
  min-height: 44px;
  padding: 0 var(--sp-4);
  border-radius: var(--radius-input);
  border: 1px solid var(--rule);
  background: var(--sheet);
  color: var(--ink);
  font-size: 15px;
}
.pg-practice__btn--primary {
  border-color: var(--accent);
  color: #fff;
  background: var(--accent);
}
.pg-practice__btn:disabled,
.pg-practice__btn--disabled {
  opacity: 0.45;
}
/* #15 拍照识别：确认后的草稿卡 + 识别中占位（02 §4.5/§4.6） */
.pg-practice__draft {
  margin-bottom: var(--sp-2);
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  border-left: 3px solid var(--accent);
}
.pg-practice__drafthead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}
.pg-practice__drafttitle {
  font-family: var(--font-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.pg-practice__draftmeta { color: var(--ink-2); }
.pg-practice__drafttext {
  padding: var(--sp-2);
  border-radius: var(--radius-input);
  background: var(--paper);
  color: var(--ink);
}
.pg-practice__draftrow { display: flex; gap: var(--sp-2); }
.pg-recogmask {
  position: fixed;
  inset: 0;
  z-index: 66;
  display: flex;
  align-items: flex-end;
  background: color-mix(in srgb, var(--ink) 35%, transparent);
}
.pg-recogloading {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
}
.pg-recogloading__title {
  font-family: var(--font-serif);
  font-weight: 600;
}
.pg-recogloading__hint { color: var(--ink-2); }
.pg-practice__placeholder { padding: var(--sp-3); }
.pg-practice__done { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-practice__donetitle { font-family: var(--font-serif); font-size: 20px; font-weight: 600; }
.pg-practice__donebody { color: var(--ink-2); }
.pg-practice__donerow { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
.pg-practice__mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(29, 36, 48, 0.2);
}
.pg-toast {
  position: fixed;
  left: 50%;
  bottom: calc(120px + var(--safe-bottom));
  transform: translateX(-50%);
  z-index: 80;
  max-width: 80vw;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-input);
  background: rgba(29, 36, 48, 0.92);
  color: #fff;
  text-align: center;
}
</style>
