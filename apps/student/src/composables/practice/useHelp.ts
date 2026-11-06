/**
 * 求助（#16；PR #91 审计）：抽屉开关、预览卡、行批注的本地 overlay。
 * 只搬运服务端结果，不判定门槛与预算。
 */
import { computed, ref, watch, type ComputedRef } from 'vue'
import { claimHint, requestHelp } from '@/api/client'
import { filterDismissedNotes, mergeNotes, parseNote } from '@/components/layers/proofLines'
import { softLandingLabel } from '@/components/hintPreviewCopy'
import { useToast } from '@/components/ui/useToast'
import type { HelpIntent, HintPreview, Note } from '@/types/attempt'
import type { AttemptSession } from './useAttemptSession'

export function useHelp(
  session: Pick<AttemptSession, 'state' | 'error' | 'apply' | 'run'>,
  exam: { strictHelpOff: ComputedRef<boolean> },
) {
  const { state, error, apply, run } = session
  const toast = useToast()

  const helpOpen = ref(false)
  const hintPreview = ref<HintPreview | null>(null)
  /** /help 返回的 note 卡片（H0/H1 提示、概念解释、施压拒绝、off_topic 都在抽屉里，01 §4） */
  const helpNote = ref<Note | null>(null)
  /**
   * #151（#141 P2-1 A 侧）：check_line 的行批注本地渲染。
   * 和 state.notes（刷新/重连后由服务端下发）按 noteId 去重合并后渲染；关闭只影响本页展示，不回写服务端。
   */
  const sessionLineNotes = ref<Note[]>([])
  /** 学生手动关闭的批注 id（只影响本页展示；刷新后以服务端 state 为准）。 */
  const dismissedNoteIds = ref<Set<string>>(new Set())
  /** 最近一次求助请求：预览卡「重新获取预览」/ dwell 归零时按原意图重放 */
  const lastHelp = ref<{ intent: HelpIntent; text: string }>({ intent: 'concept', text: '' })

  const notes = computed(() => state.value.notes ?? [])
  /** 实际渲染的批注：state.notes（服务端）+ 本次会话 check_line 返回的 res.note，按 noteId 去重并去掉已关闭的。 */
  const visibleNotes = computed(() => filterDismissedNotes(mergeNotes(notes.value, sessionLineNotes.value), dismissedNoteIds.value))
  const asideNotes = computed(() =>
    visibleNotes.value
      .filter((n) => n.kind === 'annotation' || n.kind === 'hint' || n.kind === 'concept' || n.kind === 'refusal' || n.kind === 'student')
      .slice(-8)
      .reverse(),
  )

  function openHelp(): void {
    // #46 测验模式：布置关闭求助时只提示；只开概念时抽屉（HelpDrawer 在 test 模式已只保留概念）。
    if (exam.strictHelpOff.value) {
      toast.show('测验模式已关闭提示；如卡住请联系老师。')
      return
    }
    helpOpen.value = true
  }

  function setHelpOpen(v: boolean): void {
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
  async function runHelp(intent: HelpIntent, text = ''): Promise<void> {
    const res = await run(() => requestHelp(state.value, intent, text))
    if (!res) {
      // run() 会把错误放进 store.error；不再静默失败（PR #91 审计建议）
      toast.show(error.value ?? '求助暂时不可用，请稍后再试')
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
      toast.show('批注已放到这一行下方')
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
    toast.show(routed === 'concept' ? '概念解释暂不可用，请稍后再试' : '暂时没有新的内容，稍后再试')
  }

  function pickIntent(intent: HelpIntent): void {
    void runHelp(intent)
  }

  /** 自由提问：契约 intent=free（06 §3.4），服务端据此跑施压/注入规则（B 的 #29）。 */
  function sendQuestion(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      toast.show('先写一句你卡在哪')
      return
    }
    void runHelp('free', trimmed)
  }

  /** 预览卡「重新获取预览」/ dwell 归零：按原意图重新 /help（不自行放开门槛）。 */
  function retryPreview(): void {
    const { intent, text } = lastHelp.value
    hintPreview.value = null
    void runHelp(intent, text)
  }

  async function claim(): Promise<void> {
    const preview = hintPreview.value
    if (!preview) return
    const next = await run(() => claimHint(state.value, preview))
    if (!next) {
      // 领取失败（真实接口下 409 HINT_PREVIEW_EXPIRED / HINT_NOT_READY）：清掉旧卡并提示，避免继续点过期 token
      hintPreview.value = null
      toast.show(error.value ?? '领取失败，请重新获取预览')
      return
    }
    apply(next)
    hintPreview.value = null
    const wait = typeof next.help.waitSec === 'number' && next.help.waitSec > 0 ? next.help.waitSec : 0
    toast.show('已领取；下一级要等你再写一行' + (wait > 0 ? '并停留 ' + wait + ' 秒' : '') + '后才能继续')
  }

  function decline(): void {
    hintPreview.value = null
  }

  /** 软着陆出路（01 §4.4；文案与抽屉/预览卡共用 hintPreviewCopy，页面只显示选择，不实现微课跳转）。 */
  function softLanding(action: string): void {
    helpOpen.value = false
    helpNote.value = null
    hintPreview.value = null
    toast.show('已选「' + softLandingLabel(action) + '」，这个入口还在准备')
  }

  /** #151：关闭一条批注（只影响本页展示，不回写服务端；刷新后以服务端 state 为准）。 */
  function dismissNote(noteId: string): void {
    if (!noteId) return
    dismissedNoteIds.value = new Set([...dismissedNoteIds.value, noteId])
  }

  /** 切换 mock/作答时清掉本地行批注（避免把上一份状态的行批注带到新状态上）。 */
  function resetLineNotes(): void {
    sessionLineNotes.value = []
    dismissedNoteIds.value = new Set()
  }

  /** 切换 mock 状态时收起一切求助界面。 */
  function reset(): void {
    resetLineNotes()
    hintPreview.value = null
    helpNote.value = null
    lastHelp.value = { intent: 'concept', text: '' }
    helpOpen.value = false
  }

  // 作答切换（真实模式重连/换题）时，本地 overlay 只对当前作答有效。
  watch(
    () => state.value.attemptId,
    () => resetLineNotes(),
  )

  return {
    helpOpen,
    hintPreview,
    helpNote,
    visibleNotes,
    asideNotes,
    openHelp,
    setHelpOpen,
    pickIntent,
    sendQuestion,
    retryPreview,
    claim,
    decline,
    softLanding,
    dismissNote,
    reset,
  }
}

export type HelpHandle = ReturnType<typeof useHelp>
