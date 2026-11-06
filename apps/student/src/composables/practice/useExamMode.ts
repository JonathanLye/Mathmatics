/**
 * #46 严格测验模式（11 §5.2/5.3）：说明页、倒计时、水印、切出警告、锁定轮询、全屏。
 * 只渲染服务端 state，不做本地计数/锁定判定。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getAttempt } from '@/api/client'
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
import { useToast } from '@/components/ui/useToast'
import { initIntegrity } from '@/integrity/sdk'
import { installExamMockHook } from '@/mocks/examSim'
import { useSession } from '@/stores/session'
import { mockEnabled, type AttemptSession } from './useAttemptSession'

/** 说明页「开始」后才进入作答；刷新时用 sessionStorage 记住本 tab 已开始（契约没有 exam.started 字段）。 */
const EXAM_STARTED_KEY = 'pg.exam.started:'

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

export function useExamMode(session: Pick<AttemptSession, 'state' | 'apply' | 'realMode' | 'isCompleted'>) {
  const { state, apply, realMode, isCompleted } = session
  const { me: sessionMe } = useSession()
  const toast = useToast()
  const integrity = initIntegrity()

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
      toast.show('暂时无法获取最新状态，请稍后再试')
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
  /** #46 e2e：mock 构建下安装显式的「服务端模拟」hook（window.__PG_EXAM_MOCK__），真实模式不安装。 */
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

  return {
    examStarted,
    examStartBusy,
    fullscreenExitVisible,
    fullscreenNote,
    leaveWarningVisible,
    leaveWarningCount,
    examRefreshing,
    strictExam,
    strictExamActive,
    examIsLocked,
    maxWarnings,
    warnings,
    countdownText,
    timeUp,
    watermarkContent,
    strictHelpOff,
    startExam,
    returnFullscreen,
    refreshExamState,
    ensureExamMockHook,
    cleanupExam,
  }
}

export type ExamHandle = ReturnType<typeof useExamMode>
