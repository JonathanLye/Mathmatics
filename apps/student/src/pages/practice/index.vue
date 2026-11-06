<script setup lang="ts">
import PgButton from '@/components/ui/PgButton.vue'
import PgFold from '@/components/ui/PgFold.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { useToast } from '@/components/ui/useToast'
import { COPY, independenceCopy, layerName, noteWhoLabel } from '@/copy'
import { setFeedbackTestMode } from '@/motion/useFeedbackPrefs'
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
import WechatHint from '@/components/WechatHint.vue'
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
import InkCanvas from '@ui-math/InkCanvas.vue'
import PhotoRecognitionPanel from '@/components/PhotoRecognitionPanel.vue'
import { takePendingAttempt, useAttempt } from '@/stores/attempt'
import { ageGatePassed, enforceAgeGate } from '@/auth/ageGuard'
import { softLandingLabel } from '@/components/hintPreviewCopy'
import { compressImage, loadImageBlobFromPath } from '@/utils/imageCompress'
import { uuidv7 } from '@/integrity/ids'
import { isApiError } from '@/api/http'
import { useViewport } from '@/composables/useViewport'
import { parseMockKey, type MockKey } from '@/mocks/attemptStates'
import {
  addLine,
  addTransferLine,
  claimHint,
  noteFeedback,
  flagTeacher,
  completeTransferParent,
  deleteTransferLine,
  editTransferLine,
  fetchLesson,
  checkLesson,
  finishSteps,
  finishTransfer,
  confirmRecognition,
  getAttempt,
  isMockMode,
  photoRecognitionErrorMessage,
  recognizeInk,
  recognizePhoto,
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
const toast = useToast()
/** #15 拍照识别确认：识别中 → 确认面板；确认后的文本进入「草稿」并回填行编辑器 */
const recogOpen = ref(false)
const recogBusy = ref(false)
const recognition = ref<Recognition | null>(null)
const recogDraft = ref<{ text: string; recogId: string; at: string; source?: 'ink' | 'photo'; draftId?: string } | null>(null)
/** #21 手写：全屏手写面板（InkCanvas）；写完一行 → /recognitions/ink → 确认卡 → 确认 → 行编辑器 → 以 ink 来源提交。 */
const inkOpen = ref(false)
const inkValue = ref('')
/** 本次识别结果的来源：手写（单行确认卡）或拍照（逐行面板）；影响加载文案与「重写」行为。 */
const recogSource = ref<'ink' | 'photo'>('photo')
/** 一行一个 draftId（03 §1）：识别请求与随后提交这一行复用同一个。 */
let inkDraftId = ''
/** #25 拍照：压缩/识别进度文案；photoAdding=正在把选中的行加入证明。 */
const photoProgress = ref('')
const photoAdding = ref(false)
/** 本次识别结果是否进入「逐行确认」面板（整页拍照；即便加到只剩 1 行也保持该面板，不回退到单行卡）。 */
const photoPanelActive = ref(false)
/** 最近一次压缩后的图片：重新识别时复用（不重拍、不再压缩）。 */
let lastPhoto: { image: Blob; source: 'camera' | 'album' } | null = null
/** 取消/重开时忽略在途识别结果。 */
let recogSeq = 0
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
const layerTitle = computed(() => layerName(currentLayer.value))
const layerTask = computed(() => {
  if (currentLayer.value === 'L1') return state.value.def?.task ?? ''
  if (currentLayer.value === 'L2') return state.value.frame?.task ?? ''
  if (currentLayer.value === 'L3') return '每次写一行：结论 + 依据。顺序由你决定。'
  return ''
})
const modeClass = computed(() => 'pg-practice--' + mode.value)

// 测验模式没有音效和游戏化：进出做题页时切换全局静音。
watch(
  () => state.value.mode,
  (attemptMode) => setFeedbackTestMode(attemptMode === 'test'),
  { immediate: true },
)
onUnmounted(() => setFeedbackTestMode(false))
const strictClass = computed(() => ({ 'pg-practice--strict': strictExamActive.value }))
/** #27：打开行编辑器时的初始值 —— 识别确认的文本优先（#15 行为），否则用本机未提交草稿。 */
const editorInitialStatement = computed(() => recogDraft.value?.text ?? lineDraftInitial.value.statement)
const editorInitialJustification = computed(() => lineDraftInitial.value.justification)
/* 拍照整页识别结果统一走逐行确认面板（photoPanelActive）；旧 #15 两路卡只作单行回退。 */

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
  toast.show(msg)
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
  show('这一层现在还不能跳过去')
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
  show('这一层暂时没有讲解')
}

async function checkMicro(stepId: string, choice: number) {
  const lesson = microLesson.value
  if (!lesson) return null
  return checkLesson(state.value, lesson.conceptId, stepId, choice)
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

/** 手写确认过的文字原样提交 → 来源记为 ink（带 recogId）；改过就按键盘（学生已经自己动了笔）。 */
function withInkProvenance(draft: LineDraft): LineDraft {
  const rd = recogDraft.value
  if (!rd || rd.source !== 'ink' || !rd.recogId) return draft
  if (draft.statement.trim() !== rd.text.trim()) return draft
  return { ...draft, input: { provenance: 'ink', draftId: rd.draftId || draft.input.draftId, recogId: rd.recogId } }
}

async function handleAddLine(draft: LineDraft) {
  const attemptId = state.value.attemptId
  const toSend = withInkProvenance(draft)
  const next = await run(() => addLine(state.value, toSend))
  if (next) {
    apply(next)
    editorOpen.value = false
    recogDraft.value = null
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

async function handleNoteFeedback(noteId: string, useful: boolean) {
  try {
    await noteFeedback(noteId, useful)
    show('收到，谢谢')
  } catch {
    // 反馈失败不打断学习
  }
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
async function handleSoftLanding(action: string) {
  if (action === 'flag_teacher') {
    const next = await run(() => flagTeacher(state.value))
    if (next) {
      apply(next)
      show('已告诉老师，老师会看到你在这一步的卡点')
    } else show(error.value ?? '暂时联系不上老师，请稍后再试')
    return
  }
  helpOpen.value = false
  helpNote.value = null
  hintPreview.value = null
  show('已选「' + softLandingLabel(action) + '」，这个入口还在准备')
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

function openInkSheet() {
  inkValue.value = ''
  inkDraftId = uuidv7()
  inkOpen.value = true
}

function handleInk() {
  // 手写与拍照一样用于第 3 层写证明行（其他层的输入框先用键盘）。
  if (state.value.currentLayer !== 'L3') {
    show('手写用于第 3 层写证明行；这一层先用键盘')
    return
  }
  if (recogBusy.value) return
  openInkSheet()
}

function handleInkCancel() {
  inkOpen.value = false
}

/** 手写识别错误 → 学生可读文案（真实服务端语义；不暗示对错，给出键盘兜底）。 */
function inkRecognitionErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    if (err.code === 'RATE_LIMITED' || err.status === 429) {
      return err.message.trim() === '' ? '识别太频繁或今天的次数用完了，可以先用键盘' : err.message
    }
    if (err.code === 'UPSTREAM_UNAVAILABLE' || err.status === 503) return '没认出来，再写一次，或者用键盘'
    if (err.code === 'PAYLOAD_TOO_LARGE' || err.status === 413) return '这一行写得太满了，分两行写或用键盘'
    if (err.status === 404 || err.code === 'NOT_FOUND') return '识别记录或作答不存在，请重新手写或改用键盘'
    if (err.code === 'CONSENT_REQUIRED') return '请先阅读并签署知情同意书，再使用手写识别'
    if (err.code === 'AGE_BAND_REQUIRED') return '请先选择年龄段，再使用手写识别'
    if (err.code === 'AGE_RESTRICTED') return '本服务暂未向 14 岁以下学生开放'
    if (err.code === 'FORBIDDEN') return '当前账号不能使用手写识别，请用键盘'
    if (err.code === 'ATTEMPT_LOCKED') return '本题已锁定，请联系老师'
    if (err.code === 'RECOG_NOT_CONFIRMED') return '识别结果还没确认，请先确认再加入'
    if (err.code === 'VALIDATION_FAILED') return '手写数据无效，请重新写一次或用键盘'
    if (err.code === 'NETWORK' || err.status === 0) return '网络不稳定，手写识别暂不可用；可以稍后重试或用键盘'
  }
  return '手写识别暂不可用，请用键盘'
}

/** 「写完这一行」：InkCanvas 给出 gzip(ink-v1) 的 base64，调 /recognitions/ink，结果进确认卡。 */
async function handleInkFinish(base64: string) {
  inkOpen.value = false
  if (!base64) return
  const seq = ++recogSeq
  recogSource.value = 'ink'
  recogBusy.value = true
  recogOpen.value = true
  recognition.value = null
  photoPanelActive.value = false
  photoProgress.value = '正在识别这一行…'
  try {
    const result = await recognizeInk({
      attemptId: state.value.attemptId,
      draftId: inkDraftId || uuidv7(),
      target: 'line_statement',
      ink: base64,
    })
    if (seq !== recogSeq) return
    if (result.status === 'empty' || !result.text) {
      recogOpen.value = false
      show('没有识别到内容，请再写一次，或者用键盘')
      return
    }
    recognition.value = result
    recogOpen.value = false
  } catch (err) {
    if (seq !== recogSeq) return
    recogOpen.value = false
    show(inkRecognitionErrorMessage(err))
  } finally {
    if (seq === recogSeq) {
      recogBusy.value = false
      photoProgress.value = ''
    }
  }
}

function handleKeyboard() {
  editorOpen.value = true
}

/**
 * H5 选图：优先 uni.chooseImage（返回 tempFilePath）；若运行环境未注册该 API（本构建的 H5 运行时按需注册），
 * 退回原生 <input type=file>（返回 File）。两条路都支持相机/相册：camera 带 capture=environment。
 * 取消选择返回 null（不弹错误）。
 */
function pickImageWithDomInput(source: 'camera' | 'album'): Promise<File | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不支持拍照，请用键盘或手写'))
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    if (source === 'camera') input.setAttribute('capture', 'environment')
    input.setAttribute('data-testid', 'photo-file-input')
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.top = '0'
    input.style.opacity = '0'
    document.body.appendChild(input)
    let settled = false
    const cleanup = (): void => {
      if (input.parentNode) input.parentNode.removeChild(input)
    }
    input.addEventListener('change', () => {
      if (settled) return
      settled = true
      const file = input.files && input.files[0] ? input.files[0] : null
      cleanup()
      resolve(file)
    })
    input.addEventListener('cancel', () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    })
    input.click()
  })
}

function choosePhotoFile(source: 'camera' | 'album'): Promise<File | string | null> {
  const uniApi = (typeof uni !== 'undefined' ? uni : undefined) as
    | { chooseImage?: (options: Record<string, unknown>) => void }
    | undefined
  if (typeof uniApi?.chooseImage !== 'function') {
    return pickImageWithDomInput(source)
  }
  return new Promise((resolve, reject) => {
    uniApi.chooseImage?.({
      count: 1,
      sizeType: ['compressed'],
      sourceType: [source],
      success: (result: { tempFilePaths?: string[] }) => {
        const path = result?.tempFilePaths?.[0]
        resolve(typeof path === 'string' && path.length > 0 ? path : null)
      },
      fail: (error: { errMsg?: string } | undefined) => {
        const message = String(error?.errMsg ?? error ?? '')
        if (/cancel/i.test(message)) {
          resolve(null)
          return
        }
        reject(new Error(message || '选择图片失败'))
      },
    })
  })
}

/**
 * #25 拍照识别：选择图片 → 压缩（长边≤2000/≤2MB/去 EXIF）→ POST /recognitions/photo → 逐行确认。
 * - 真实后端已上线；404 表示作答/识别记录不存在，提示重新拍照或改用键盘，不伪造结果；
 * - 测验模式 photo 已禁用；取消选择不提示错误；
 * - 取消/重新打开时用 recogSeq 忽略在途结果。
 */
async function startPhotoRecognition() {
  if (recogBusy.value) return
  if (state.value.integrity.mode === 'test') {
    show('测验模式下拍照不可用')
    return
  }
  // 拍照识别用于整页切行后加入第 3 层证明行（复用 addLine；其他层没有行列表落点）。
  if (state.value.currentLayer !== 'L3') {
    show('拍照识别用于第 3 层写证明行；请先完成前两层')
    return
  }
  const seq = ++recogSeq
  recogSource.value = 'photo'
  recogBusy.value = true
  recogOpen.value = true
  recognition.value = null
  photoPanelActive.value = false
  photoProgress.value = '正在打开相机…'
  try {
    const picked = await choosePhotoFile('camera')
    if (seq !== recogSeq) return
    if (!picked) {
      closeRecogLoading()
      return
    }
    photoProgress.value = '正在压缩图片…'
    const sourceBlob = typeof picked === 'string' ? await loadImageBlobFromPath(picked) : picked
    const compressed = await compressImage(sourceBlob, { maxEdge: 2000, maxBytes: 2 * 1024 * 1024 })
    if (seq !== recogSeq) return
    lastPhoto = { image: compressed.blob, source: 'camera' }
    photoProgress.value = '正在识别…'
    const result = await recognizePhoto({
      attemptId: state.value.attemptId,
      draftId: uuidv7(),
      target: 'line_statement',
      source: 'camera',
      image: compressed.blob,
    })
    if (seq !== recogSeq) return
    recognition.value = result
    photoPanelActive.value = true
    recogOpen.value = false
  } catch (error) {
    if (seq !== recogSeq) return
    recogOpen.value = false
    show(photoRecognitionErrorMessage(error))
  } finally {
    if (seq === recogSeq) {
      recogBusy.value = false
      photoProgress.value = ''
    }
  }
}

function handlePhoto() {
  void startPhotoRecognition()
}

/** 逐行确认面板：加入勾选行/单行 → 走既有 addLine（provenance=photo + recogId）→ 调 confirm。 */
async function handlePhotoAdd(payload: { texts: string[]; indices: number[] }) {
  const current = recognition.value
  if (!current || photoAdding.value) return
  if (payload.texts.length === 0) {
    show('没有可加入的行')
    return
  }
  photoAdding.value = true
  recogBusy.value = true
  const recogId = current.recogId
  const added: string[] = []
  try {
    // 03 §3.2：只有确认过的识别结果才能用于提交——先 confirm（服务端记下确认的各行），再逐行加入。
    const toAdd = payload.texts.map((text) => text.trim()).filter((text) => text !== '')
    try {
      await confirmRecognition(recogId, toAdd.join('\n'), toAdd)
    } catch (err) {
      show(photoRecognitionErrorMessage(err))
      return
    }
    for (const trimmed of toAdd) {
      const draft: LineDraft = {
        statement: trimmed,
        input: { provenance: 'photo', draftId: uuidv7(), recogId },
      }
      const next = await run(() => addLine(state.value, draft))
      if (!next) {
        show(error.value || '加入行失败，请重试')
        return
      }
      apply(next)
      added.push(trimmed)
    }
    if (added.length === 0) {
      show('没有可加入的行')
      return
    }
    const remainingLines = (current.lines ?? []).filter((_, index) => !payload.indices.includes(index))
    if (remainingLines.length > 0) {
      recognition.value = {
        ...current,
        lines: remainingLines,
        text: remainingLines.map((line) => line.text).join('\n'),
      }
    } else {
      recognition.value = null
      photoPanelActive.value = false
    }
    show('已加入 ' + added.length + ' 行（拍照识别）')
  } finally {
    photoAdding.value = false
    recogBusy.value = false
  }
}

/** 忽略整次拍照识别。 */
function handleRecogIgnore() {
  recogSeq += 1
  recognition.value = null
  photoPanelActive.value = false
  recogOpen.value = false
  show('已忽略这次拍照识别，可以继续写')
}

/** 「重新识别」：单行结果（#15 卡）重新跑一次；多行面板暂不提供重识别按钮。 */
async function handleRecogRewrite() {
  if (recogSource.value === 'ink') {
    // 手写：放弃这次结果，回到画布重写一遍（不重复识别同一份笔迹）。
    recogSeq += 1
    recognition.value = null
    recogOpen.value = false
    recogBusy.value = false
    openInkSheet()
    return
  }
  // 拍照：丢弃当前结果并重新走 /recognitions/photo；有压缩图时复用（不再重拍/压缩），
  // 没有压缩图则重新打开拍照选择。绝不能调用 recognizeInk（那会把照片当手写发）。
  recogSeq += 1
  recognition.value = null
  photoPanelActive.value = false
  recogOpen.value = false
  recogBusy.value = false
  const previous = lastPhoto
  if (previous === null) {
    void startPhotoRecognition()
    return
  }
  const retrySeq = recogSeq
  recogSource.value = 'photo'
  recogBusy.value = true
  recogOpen.value = true
  photoProgress.value = '正在重新识别…'
  try {
    const result = await recognizePhoto({
      attemptId: state.value.attemptId,
      draftId: uuidv7(),
      target: 'line_statement',
      source: previous.source,
      image: previous.image,
    })
    if (retrySeq !== recogSeq) return
    recognition.value = result
    photoPanelActive.value = true
    recogOpen.value = false
  } catch (error) {
    if (retrySeq !== recogSeq) return
    recogOpen.value = false
    show(photoRecognitionErrorMessage(error))
  } finally {
    if (retrySeq === recogSeq) {
      recogBusy.value = false
      photoProgress.value = ''
    }
  }
}

/** 确认加入：识别结果进入草稿（mock 下页面能看到结果文本），并回填行编辑器 */
async function handleRecogConfirm(text: string) {
  const current = recognition.value
  const recogId = current?.recogId ?? ''
  const fromInk = recogSource.value === 'ink'
  if (fromInk && current && !isMockMode()) {
    // 先 confirm，之后才能以手写来源提交（服务端核对提交文字与确认文字一致）。失败则留在确认卡里，学生可重试。
    recogBusy.value = true
    try {
      await confirmRecognition(recogId, text)
    } catch (err) {
      show(inkRecognitionErrorMessage(err))
      return
    } finally {
      recogBusy.value = false
    }
  }
  photoPanelActive.value = false
  recogOpen.value = false
  recognition.value = null
  recogDraft.value = {
    text,
    recogId,
    at: new Date().toISOString(),
    source: fromInk ? 'ink' : 'photo',
    draftId: fromInk ? inkDraftId : undefined,
  }
  if (fromInk) {
    // 手写确认后直接进行编辑器：补依据后提交；文字不改则按 ink 来源提交。
    editorOpen.value = true
    show('已确认，补上依据后加入证明')
  } else {
    show('识别结果已放入草稿，继续写这一行')
  }
}

/** 放弃重写：关掉面板，不采用这次识别 */
function handleRecogDiscard() {
  recogOpen.value = false
  recognition.value = null
  show('已放弃这次识别，可以重新写')
}

function closeRecogLoading() {
  recogSeq += 1
  recogOpen.value = false
  recognition.value = null
  recogBusy.value = false
  photoProgress.value = ''
}

function handleBack() {
  // 直接打开链接时没有上一页，回到路径。
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/home/index' })
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
    <!-- #37 微信内打开提示：非阻塞横条，非微信 UA 不渲染 -->
    <WechatHint />

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
      <PgButton variant="ghost" size="sm" @tap="backHome">回首页</PgButton>
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
            <PgButton variant="ghost" size="sm" data-testid="draft-restored-dismiss" @tap="restoredDraft = null">知道了</PgButton>
          </view>

          <view v-if="!isCompleted" class="pg-practice__head">
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
              <text class="pg-practice__donetitle" data-testid="transfer-complete-title">这道题也完成了</text>
              <view class="pg-practice__donebody pg-small">
                <MathText :text="state.problem.title" />：你把 $\varepsilon$-$N$ 的骨架用到了 $\varepsilon$-$\delta$ 上。
              </view>
              <text class="pg-practice__donebody pg-small">{{ independenceCopy(state.budget.keysOwn, state.budget.keysTotal) }}。</text>
              <PgFold :title="COPY.extensionFold" class="pg-practice__donebody">
                <text>mathlib4 对照（只列定理名）：{{ state.completion?.leanCard?.theorems?.join('、') ?? '—' }}</text>
              </PgFold>
              <view class="pg-practice__donerow">
                <PgButton variant="secondary" data-testid="back-to-parent" @tap="handleBackToParent">回到本题完成页</PgButton>
                <PgButton data-testid="transfer-add-to-notebook" @tap="goProofbook">加入证明本</PgButton>
              </view>
            </view>

            <view v-else class="pg-practice__done pg-practice__done--win" data-testid="completion-card">
              <view class="pg-win__paper" aria-hidden="true">
                <view class="pg-win__sk" style="width: 82%" /><view class="pg-win__sk" style="width: 64%" /><view class="pg-win__sk" style="width: 73%" />
                <view class="pg-win__stamp"><PgIcon name="qed" :size="44" color="currentColor" /></view>
              </view>
              <view class="pg-win__mascot"><PgMascot expr="cheer" :size="84" /></view>
              <text class="pg-practice__donetitle" data-testid="completion-title">本题完成</text>
              <text class="pg-win__big" data-testid="completion-independence">{{ independenceCopy(state.budget.keysOwn, state.budget.keysTotal) }}</text>
              <view class="pg-win__keys" aria-hidden="true">
                <view
                  v-for="k in state.budget.keysTotal"
                  :key="k"
                  class="pg-win__key"
                  :class="{ 'pg-win__key--hint': k > state.budget.keysOwn }"
                >
                  <PgIcon :name="k > state.budget.keysOwn ? 'bulb' : 'check'" :size="26" tone="ink" />
                </view>
              </view>
              <text class="pg-practice__donebody pg-small">
                自己写出 {{ state.budget.keysOwn }} / {{ state.budget.keysTotal }} 个关键步骤；{{ COPY.hintBudget }}用了 {{ state.budget.revealUsed }} / {{ state.budget.revealMax }}。
              </text>
              <text v-if="state.completion?.leanCard?.steps?.length" class="pg-practice__donebody pg-small">
                你写出的关键步骤：{{ state.completion?.leanCard?.steps?.map((s) => s.label).join('、') }}
              </text>
              <text class="pg-practice__donebody pg-small">{{ COPY.honestNote }}。</text>
              <PgFold :title="COPY.extensionFold" class="pg-practice__donebody">
                <text>mathlib4 对照（只列定理名）：{{ state.completion?.leanCard?.theorems?.join('、') ?? '—' }}</text>
              </PgFold>
              <view class="pg-practice__donerow pg-practice__donerow--win">
                <PgButton class="pg-win__btn" variant="secondary" block size="lg" data-testid="add-to-notebook" @tap="goProofbook">加入证明本</PgButton>
                <PgButton class="pg-win__btn pg-win__btn--ghost" variant="ghost" block data-testid="make-transfer" @tap="handleMakeTransfer">再换一道题试试</PgButton>
                <PgButton class="pg-win__btn pg-win__btn--ghost" variant="ghost" block data-testid="back-home" @tap="backHome">回首页</PgButton>
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
                <text class="pg-practice__drafttitle">识别结果（已确认）</text>
                <text class="pg-practice__draftmeta pg-small">已放入这一行草稿</text>
              </view>
              <view class="pg-practice__drafttext">
                <MathText :text="recogDraft.text" block />
              </view>
              <view class="pg-practice__draftrow">
                <PgButton class="pg-practice__draftbtn--continue" variant="secondary" size="sm" @tap="editorOpen = true">用键盘继续改</PgButton>
                <PgButton class="pg-practice__draftbtn--clear" variant="ghost" size="sm" @tap="recogDraft = null">清除草稿</PgButton>
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
              <PgButton size="lg" data-testid="finish-steps" sound="tap" :disabled="!state.steps?.canFinish || busy" @tap="handleFinish">写完了</PgButton>
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
            <text class="pg-practice__layertitle">{{ layerTitle }}</text>
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
          :aria-label="noteWhoLabel(n.who) + '：' + n.text"
        >
          <view class="pg-practice__notehead">
            <text class="pg-practice__notewho pg-small">{{ noteWhoLabel(n.who) }}</text>
            <text
              v-if="formatNoteTime(n.at)"
              class="pg-practice__notetime pg-small"
              data-testid="aside-note-time"
            >{{ formatNoteTime(n.at) }}</text>
            <PgButton
              class="pg-practice__notedismiss"
              variant="ghost"
              size="icon"
              aria-label="关闭这条批注"
              data-testid="aside-note-dismiss"
              :data-note-id="n.noteId"
              @tap.stop="handleDismissNote(n.noteId)"
            ><PgIcon name="close" :size="18" /></PgButton>
          </view>
          <MathText class="pg-practice__notetext pg-small" :text="n.text" block />
        </view>
        <text v-if="asideNotes.length === 0" class="pg-practice__empty pg-small">还没有批注。写完一行，助教的问题会出现在这一行旁边。</text>
        <view class="pg-practice__asidehelp">
          <PgButton
            class="pg-practice__btn"
            variant="hint"
            block
            :disabled="strictHelpOff"
            :data-testid="strictExam ? 'exam-help-aside' : undefined"
            @tap="openHelp"
          >求助</PgButton>
        </view>
      </view>
    </view>

    <view v-if="mode === 'mobile' && !isCompleted" class="pg-practice__dockwrap">
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
      @feedback="handleNoteFeedback"
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

    <!-- #21 手写：全屏手写面板；「写完这一行」才调识别（不做实时识别） -->
    <view v-if="inkOpen" class="pg-inksheet" data-testid="ink-sheet" role="dialog" aria-modal="true" aria-label="手写这一行">
      <view class="pg-inksheet__bar">
        <text class="pg-inksheet__title">手写第 {{ nextLineNo }} 行</text>
        <PgButton variant="secondary" size="sm" data-testid="ink-cancel" @tap="handleInkCancel">取消</PgButton>
      </view>
      <view class="pg-inksheet__stage">
        <InkCanvas v-model="inkValue" height="100%" @finish="handleInkFinish" />
      </view>
    </view>

    <!-- #15 拍照识别：识别中的占位（02 §4.5：超过 3 秒提示可先用键盘），拿到结果后进确认面板 -->
    <view v-if="recogOpen && !recognition" class="pg-recogmask">
      <view class="pg-recogloading pg-sheet">
        <text class="pg-recogloading__title" data-testid="photo-progress">{{ photoProgress || '识别中…' }}</text>
        <text v-if="recogSource === 'ink'" class="pg-recogloading__hint pg-small">识别结果只是候选，要你核对确认后才会用；识别不好可以改用键盘。</text>
        <text v-else class="pg-recogloading__hint pg-small">图片会先压缩（长边≤2000/≤2MB）再识别；结果要你逐行确认后才会用。</text>
        <PgButton variant="secondary" block @tap="closeRecogLoading">取消</PgButton>
      </view>
    </view>
    <!-- #25 拍照整页识别：逐行确认（可勾选/编辑/全部加入/逐行加入/忽略） -->
    <PhotoRecognitionPanel
      v-if="recognition && photoPanelActive"
      :recognition="recognition"
      :busy="recogBusy || photoAdding"
      @add="handlePhotoAdd"
      @ignore="handleRecogIgnore"
    />
    <!-- 单行结果沿用 #15 两路确认卡 -->
    <RecognitionConfirm
      v-else-if="recognition"
      :recognition="recognition"
      :busy="recogBusy"
      @rewrite="handleRecogRewrite"
      @confirm="handleRecogConfirm"
      @discard="handleRecogDiscard"
    />
    <MicroCourse :open="microOpen" :lesson="microLesson" :check="checkMicro" @close="closeMicro" />

    <!-- 真实模式和生产构建都不显示演示状态切换（#24） -->
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
        <PgButton block size="lg" data-testid="exam-return-fullscreen" @tap="returnFullscreen">回到全屏</PgButton>
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
  border-bottom: 2px solid var(--accent);
  color: var(--accent-text);
}
.pg-exambar__label { font-size: var(--fs-13); font-weight: var(--fw-bold); }
.pg-exambar__time { margin-left: auto; font-size: var(--fs-16); }
.pg-exambar__note { flex-basis: 100%; color: var(--bee-text); }
.pg-fsexit {
  position: fixed;
  inset: 0;
  z-index: 87;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: var(--mask-strong);
}
.pg-fsexit__sheet {
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--sheet);
  border: 2px solid var(--rule);
  border-radius: var(--radius-24);
}
.pg-fsexit__title { font-size: var(--fs-22); font-weight: var(--fw-black); color: var(--ink); }
.pg-fsexit__text { color: var(--ink-2); line-height: 1.6; }
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
  border-right: var(--bw) solid var(--rule);
  padding-top: var(--sp-2);
  position: sticky;
  top: 60px;
  align-self: start;
}
.pg-practice__main {
  min-width: 0;
  /* 手机：额度条 + 操作坞的高度 */
  padding-bottom: calc(136px + var(--safe-bottom));
}
.pg-practice--tablet .pg-practice__main,
.pg-practice--desktop .pg-practice__main {
  padding: 0 var(--sp-4) var(--sp-10);
}
.pg-practice__error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--radius-12);
  background: var(--sea-soft);
  color: var(--ink);
}
.pg-practice__errortext { flex: 1; }
.pg-practice__content {
  padding: 0;
}
.pg-draftnotice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: var(--sp-2) 0;
  padding: var(--sp-2) var(--sp-3);
  border: 2px solid var(--accent);
  border-radius: var(--radius-16);
  background: var(--accent-soft);
  color: var(--ink);
  font-weight: var(--fw-bold);
}
.pg-draftnotice__text { flex: 1; min-width: 0; }
.pg-practice__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--sp-2) 0;
}
.pg-practice__layertitle {
  font-size: var(--fs-22);
  font-weight: var(--fw-black);
  line-height: var(--lh-tight);
  color: var(--ink);
}
.pg-practice__layertask {
  color: var(--ink-2);
  font-weight: var(--fw-bold);
}
.pg-practice__aside {
  border-left: var(--bw) solid var(--rule);
  padding: var(--sp-3);
  min-width: 0;
}
.pg-practice__asidetitle {
  display: block;
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  margin-bottom: var(--sp-2);
}
.pg-practice__note {
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: var(--sp-2);
  border-radius: var(--radius-12);
}
.pg-practice__note--annotation { border-color: var(--sea); background: var(--sea-soft); }
.pg-practice__note--hint { border-color: var(--bee); background: var(--bee-soft); }
.pg-practice__note--concept { border-color: var(--accent); background: var(--accent-soft); }
.pg-practice__notehead { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: 2px; }
.pg-practice__notewho { display: block; color: var(--ink-2); }
.pg-practice__notetime { color: var(--ink-2); font-family: var(--font-mono); font-size: var(--fs-12); }
/* 关闭批注（#151）：触控目标 ≥44px，不额外撑高页边卡片。 */
.pg-practice__notedismiss.pg-button { margin: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) auto; color: var(--ink-2); }
.pg-practice__notetext { display: block; margin-top: 2px; color: var(--ink); }
.pg-practice__empty { color: var(--ink-2); }
.pg-practice__asidehelp { margin-top: var(--sp-3); }
/* 额度条在操作坞上方，一起贴底、一起随键盘上移（操作坞不再自己 fixed，否则会盖住额度条） */
.pg-practice__dockwrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  background: var(--paper);
  border-top: var(--bw) solid var(--rule);
  transform: translateY(calc(-1 * var(--keyboard-inset)));
  transition: transform var(--dur-fast) ease-out;
}
.pg-practice__dockwrap :deep(.pg-dock) {
  position: static;
  padding-top: 0;
  border-top: 0;
  transform: none;
}
.pg-practice__finishrow {
  display: flex;
  justify-content: flex-end;
  padding: var(--sp-3) 0 var(--sp-2);
}
/* #15 拍照识别：确认后的草稿卡 + 识别中占位（02 §4.5/§4.6） */
.pg-practice__draft {
  margin-bottom: var(--sp-2);
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  border-color: var(--accent);
}
.pg-practice__drafthead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-2);
}
.pg-practice__drafttitle {
  font-size: var(--fs-15);
  font-weight: var(--fw-black);
  color: var(--ink);
}
.pg-practice__draftmeta { color: var(--ink-2); }
.pg-practice__drafttext {
  padding: var(--sp-2);
  border-radius: var(--radius-12);
  background: var(--paper);
  color: var(--ink);
}
.pg-practice__draftrow { display: flex; gap: var(--sp-2); }
.pg-inksheet {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  flex-direction: column;
  background: var(--paper);
}
.pg-inksheet__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: var(--bw) solid var(--rule);
}
.pg-inksheet__title { font-size: var(--fs-18); font-weight: var(--fw-black); color: var(--ink); }
.pg-inksheet__stage { flex: 1; min-height: 0; }
.pg-recogmask {
  position: fixed;
  inset: 0;
  z-index: 66;
  display: flex;
  align-items: flex-end;
  background: var(--mask);
}
.pg-recogloading {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4) var(--sp-4) calc(var(--sp-4) + var(--safe-bottom));
  border-radius: var(--radius-24) var(--radius-24) 0 0;
  animation: pg-sheet-up var(--dur-slow) var(--ease-out) both;
}
.pg-recogloading__title {
  font-size: var(--fs-18);
  font-weight: var(--fw-black);
}
.pg-recogloading__hint { color: var(--ink-2); }
.pg-practice__placeholder { padding: var(--sp-3); }
.pg-practice__done { padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-practice__donetitle { font-size: var(--fs-22); font-weight: var(--fw-black); }
.pg-practice__donebody { color: var(--ink-2); font-weight: var(--fw-bold); }
.pg-practice__donerow { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
/* 完成页：整块主色 + ∎ 落章。文字用 on-accent，深浅主题都够对比度。 */
.pg-practice__done--win {
  position: relative;
  margin: var(--sp-3) calc(-1 * var(--sp-3)) 0;
  padding: 150px var(--sp-4) var(--sp-6);
  align-items: center;
  gap: var(--sp-2);
  background: var(--accent);
  color: var(--on-accent);
  border-radius: var(--radius-24);
  margin-bottom: var(--sp-6);
  text-align: center;
}
.pg-win__paper { position: absolute; left: 32px; right: 32px; top: 36px; height: 120px; padding: 20px 22px; border-radius: var(--radius-16); background: var(--sheet); box-shadow: 0 var(--lip) 0 var(--accent-lip); }
.pg-win__sk { height: 10px; margin-bottom: var(--sp-3); border-radius: var(--radius-pill); background: var(--rule); }
.pg-win__stamp { position: absolute; right: 14px; bottom: -34px; width: 80px; height: 80px; border-radius: var(--radius-24); background: var(--accent); color: var(--on-accent); border: 5px solid var(--sheet); box-shadow: 0 var(--lip) 0 var(--accent-lip); display: flex; align-items: center; justify-content: center; transform: rotate(-8deg); animation: pg-stamp 700ms var(--ease-spring) both; }
.pg-win__mascot { position: absolute; right: 18px; top: -34px; }
.pg-practice__done--win .pg-practice__donetitle { margin-top: var(--sp-3); font-size: var(--fs-15); opacity: 0.95; }
.pg-win__big { font-size: var(--fs-28); line-height: var(--lh-tight); font-weight: var(--fw-black); }
.pg-win__keys { display: flex; gap: var(--sp-2); justify-content: center; margin: var(--sp-2) 0; }
.pg-win__key { width: 44px; height: 44px; border-radius: var(--radius-12); background: var(--sheet); color: var(--ink); box-shadow: 0 var(--lip) 0 var(--accent-lip); display: flex; align-items: center; justify-content: center; animation: pg-pop 380ms var(--ease-spring) both; }
.pg-win__key--hint { background: var(--bee); color: var(--on-bee); box-shadow: 0 var(--lip) 0 var(--bee-lip); }
.pg-practice__done--win .pg-practice__donebody { color: var(--on-accent); opacity: 0.95; }
.pg-practice__donerow--win { flex-direction: column; align-self: stretch; margin-top: var(--sp-3); gap: var(--sp-3); }
.pg-win__btn--ghost.pg-button { color: var(--on-accent); }
.pg-practice__mask {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: var(--mask);
}
</style>
