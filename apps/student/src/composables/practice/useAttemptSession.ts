/**
 * 一次作答的会话：加载、把服务端 state 落到页面、各层的提交动作。
 * 只搬运服务端结果，不判定层、预算或归类（08 §8 AI 规则 3）。
 */
import { computed, ref } from 'vue'
import {
  addTransferLine,
  completeTransferParent,
  deleteTransferLine,
  editTransferLine,
  fetchLesson,
  finishSteps,
  finishTransfer,
  getAttempt,
  isMockMode,
  setMockMode,
  skipLayer,
  startAttempt,
  startTransfer,
  submitDef,
  submitFramework,
  submitSelfcheck,
  submitSummary,
  viewFrameTemplate,
} from '@/api/client'
import { nextLineNoOf } from '@/components/layers/proofLines'
import { parseMockKey, type MockKey } from '@/mocks/attemptStates'
import { takePendingAttempt, useAttempt } from '@/stores/attempt'
import { layerName } from '@/copy'
import type { AttemptState, InputProvenance, LessonView, LineDraft } from '@/types/attempt'
import type { DraftsHandle } from './useDrafts'

/** 开发期 mock 开关（PR #87 审计）：生产构建不允许用 ?mock= 切到假状态。 */
export const mockEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK === '1'

/** 迁移题子作答的行编辑入参。 */
export type TransferDraft = { statement: string; justification: string; provenance: InputProvenance }

function hashQuery(): URLSearchParams | null {
  if (!mockEnabled || typeof window === 'undefined') return null
  const hash = window.location.hash
  const i = hash.indexOf('?')
  return i === -1 ? null : new URLSearchParams(hash.slice(i + 1))
}

/** #46 e2e/演示：?exam=1 等价于 mock 的测验状态（仅 mock 构建；hash 查询兜底）。 */
function examFlagFromHash(): boolean {
  return hashQuery()?.get('exam') === '1'
}

/**
 * 从 URL hash 读取 mock 状态（H5 截图/演示用）：
 * 例如 #/pages/practice/index?mock=l3-active。
 * onLoad 收到的 options 在部分 H5 路由模式下只含 hash 前的查询，这里补一条兜底。
 * 用 parseMockKey（Object.hasOwn）校验：`in` 会命中 Object.prototype（constructor 等）→ 白屏。
 */
function mockFromHash(): MockKey | null {
  return parseMockKey(hashQuery()?.get('mock') ?? null)
}

function toLineDraft(draft: TransferDraft): LineDraft {
  return {
    statement: draft.statement,
    justification: draft.justification,
    input: { provenance: draft.provenance, draftId: 'mock-' + Date.now() },
  }
}

/** 加载阶段：loading 显示骨架，error 显示错误屏（重试 / 回首页），ready 才渲染作答。 */
export type LoadPhase = 'loading' | 'ready' | 'error'

export function useAttemptSession(drafts: DraftsHandle) {
  const { state, mockKey, busy, error, setMock, apply, clear, run } = useAttempt()
  /** 真实模式（#24）：页面按服务端 state 渲染；mock 模式保留演示状态切换。 */
  const realMode = ref(!isMockMode())
  /** 真实模式必须等服务端 state，生产构建也一样：不拿演示数据或上一次的作答顶替。 */
  const needsServerState = (): boolean => realMode.value || !mockEnabled
  const phase = ref<LoadPhase>(needsServerState() ? 'loading' : 'ready')
  const loadError = ref('')
  let lastQuery: Record<string, unknown> | undefined
  if (needsServerState()) clear()
  /** 迁移题子作答的父作答 state：子作答完成后用「回到本题完成页」恢复。 */
  const transferParent = ref<AttemptState | null>(null)

  const currentLayer = computed(() => state.value.currentLayer)
  const lines = computed(() => state.value.steps?.lines ?? [])
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

  const initialMock = mockFromHash()
  if (initialMock) setMock(initialMock)

  /** #24 真实接口开关：默认由 VITE_USE_MOCK 决定；联调/e2e 可用 ?api=real 在 mock 构建里强制真实模式。 */
  function applyApiFlag(q: Record<string, unknown> | undefined): void {
    if (q?.api === 'real') {
      setMockMode(false)
      realMode.value = true
      phase.value = 'loading'
      clear()
    }
  }

  function failLoad(message: string): void {
    loadError.value = message
    phase.value = 'error'
  }

  function markReady(): void {
    loadError.value = ''
    phase.value = 'ready'
    void drafts.restoreDrafts()
  }

  /** 页面 onLoad：按 URL 决定开始/恢复哪次作答（年龄门由页面先过）。 */
  async function load(q: Record<string, unknown> | undefined): Promise<void> {
    lastQuery = q
    // 证明本「重做」等：服务端已返回的新作答 state 通过 store 跨页交接。
    const pending = takePendingAttempt()
    if (pending) {
      transferParent.value = null
      apply(pending)
      markReady()
      return
    }
    if (needsServerState()) {
      // ?assignmentId= 开始/恢复作答（POST /student/assignments/{id}/attempt）；?attemptId= 断线重连（GET /attempts/{id}）。
      const assignmentId = q?.assignmentId ? String(q.assignmentId) : ''
      const attemptId = q?.attemptId ? String(q.attemptId) : ''
      if (!assignmentId && !attemptId) {
        failLoad('没有找到要做的题，回首页重新选一道吧。')
        return
      }
      phase.value = 'loading'
      const next = await run(() => (assignmentId ? startAttempt(assignmentId) : getAttempt(attemptId)))
      if (!next) {
        failLoad(error.value || '这道题暂时打不开，请稍后再试。')
        error.value = null
        return
      }
      apply(next)
      markReady()
      return
    }
    const k = parseMockKey(q?.mock as string | undefined) ?? initialMock
    if (k) setMock(k)
    else if (String(q?.exam ?? '') === '1' || examFlagFromHash()) setMock('exam-active')
    markReady()
  }

  /** 错误屏「重试」：用同一份 URL 参数再加载一次。 */
  function retryLoad(): Promise<void> {
    return load(lastQuery)
  }

  /** L1/L2 提交文本。 */
  async function submitText(text: string): Promise<void> {
    const layer = currentLayer.value
    const attemptId = state.value.attemptId
    const fn = layer === 'L1' ? submitDef : submitFramework
    const next = await run(() => fn(state.value, text))
    if (!next) return
    apply(next)
    // #27：提交成功后清除本机草稿（避免下次打开又恢复旧内容）。
    if (layer === 'L1') await drafts.clearDefinition(attemptId)
  }

  /** 第 1 层「看不懂」：取微课（GET /lesson/{conceptId}）。 */
  function loadLesson(): Promise<LessonView | null> {
    return run(() => fetchLesson(state.value))
  }

  /** 第 2 层「看通用骨架」→ 契约的 POST /framework/template，由服务端返回 templateShown=true 的 state。 */
  async function showFrameTemplate(): Promise<void> {
    const next = await run(() => viewFrameTemplate(state.value))
    if (next) apply(next)
  }

  /** 跳层是独立操作（POST /layers/{L}/skip）：不把「已掌握，跳过」当文本提交，也不写 def/frame.last。 */
  async function skipCurrentLayer(): Promise<void> {
    const layer = currentLayer.value
    if (layer !== 'L1' && layer !== 'L2' && layer !== 'L4' && layer !== 'L5') return
    const attemptId = state.value.attemptId
    const next = await run(() => skipLayer(state.value, layer))
    if (!next) return
    apply(next)
    if (layer === 'L1') await drafts.clearDefinition(attemptId)
  }

  /** 第 3 层「写完了」。 */
  async function finishProof(): Promise<void> {
    const next = await run(() => finishSteps(state.value))
    if (next) apply(next)
  }

  /** 第 4 层：提交一道自检题；判定与追问都来自服务端返回的 state。 */
  async function answerSelfcheckItem(itemId: string, text: string): Promise<void> {
    const next = await run(() => submitSelfcheck(state.value, itemId, text))
    if (next) apply(next)
  }

  /** 第 5 层：开始迁移题（服务端创建子作答，返回 kind=transfer 的子作答 state）。 */
  async function beginTransfer(): Promise<void> {
    const parent = state.value
    const next = await run(() => startTransfer(parent))
    if (!next) return
    transferParent.value = parent
    apply(next)
  }

  /** 迁移题子作答的行编辑：加入 / 改写 / 删除一行（归类、批注、canFinish 都由服务端返回的 state 决定）。 */
  async function addChildLine(draft: TransferDraft): Promise<void> {
    const next = await run(() => addTransferLine(state.value, toLineDraft(draft)))
    if (next) apply(next)
  }
  async function editChildLine(lineId: string, draft: TransferDraft): Promise<void> {
    const next = await run(() => editTransferLine(state.value, lineId, toLineDraft(draft)))
    if (next) apply(next)
  }
  async function deleteChildLine(lineId: string): Promise<void> {
    const next = await run(() => deleteTransferLine(state.value, lineId))
    if (next) apply(next)
  }

  /** 迁移题「写完了」：服务端判定行数/依据/关键步骤，达标才 completed。 */
  async function finishChild(): Promise<void> {
    const next = await run(() => finishTransfer(state.value))
    if (next) apply(next)
  }

  /** 迁移题完成 → 回到本题完成页（服务端已推进父作答 L5→L6；已完成的父作答原样返回）。 */
  async function backToParent(): Promise<void> {
    const parent = transferParent.value
    transferParent.value = null
    if (!parent) {
      uni.navigateTo({ url: '/pages/practice/index?mock=completed' })
      return
    }
    const next = await run(() => completeTransferParent(parent))
    apply(next ?? parent)
  }

  /** 第 6 层：提交五问总结 → 完成页。 */
  async function submitSummaryAnswers(answers: string[]): Promise<void> {
    const next = await run(() => submitSummary(state.value, answers))
    if (next) apply(next)
  }

  return {
    state,
    mockKey,
    busy,
    error,
    setMock,
    apply,
    run,
    realMode,
    phase,
    loadError,
    retryLoad,
    transferParent,
    currentLayer,
    lines,
    isCompleted,
    nextLineNo,
    isTransferAttempt,
    layerTitle,
    layerTask,
    applyApiFlag,
    load,
    submitText,
    loadLesson,
    showFrameTemplate,
    skipCurrentLayer,
    finishProof,
    answerSelfcheckItem,
    beginTransfer,
    addChildLine,
    editChildLine,
    deleteChildLine,
    finishChild,
    backToParent,
    submitSummaryAnswers,
  }
}

export type AttemptSession = ReturnType<typeof useAttemptSession>
