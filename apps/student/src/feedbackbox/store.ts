/**
 * 小方信箱的共享状态：Sheet 开关与草稿、发送、未读红点。模块级单例——AppShell、做题页、出错页各挂一份入口，
 * 但打开的是同一个 Sheet，红点是同一个数。
 */
import { computed, reactive, readonly } from 'vue'
import { ApiError, listMyFeedback, sendFeedback } from '@/api/client'
import { FBBOX_COPY } from '@/copy/feedbackbox'
import { feedbackAllowed } from '@/motion/useFeedbackPrefs'
import type { FeedbackKind } from '@/types/attempt'
import type { FeedbackContext, FeedbackReceipt } from '@/types/feedbackbox'
import { FBBOX_DRAFT_KEY, feedbackText, parseDraft, serializeDraft } from './logic'
import { collectContext } from './probe'

export interface OpenOptions {
  kind?: FeedbackKind
  /** 预填的话（比如「题目有误」直达时）。 */
  body?: string
  /** 学生圈到/点到的 data-fb 元素名。 */
  targets?: string[]
}

interface BoxState {
  open: boolean
  kind: FeedbackKind
  body: string
  sending: boolean
  error: string
  /** 打开瞬间拍下的上下文快照：学生写的时候页面可能还在变。 */
  context: FeedbackContext
  /** 发送成功后的回执：有值时 Sheet 显示「收到啦」。 */
  receipt: FeedbackReceipt | null
  unread: number
  draftRestored: boolean
  /** 「带上这些」开关：关掉时只送学生写的话。 */
  attach: boolean
}

const state = reactive<BoxState>({
  open: false,
  kind: 'bug',
  body: '',
  sending: false,
  error: '',
  context: {},
  receipt: null,
  unread: 0,
  draftRestored: false,
  attach: true,
})

function readDraft() {
  try {
    return typeof localStorage === 'undefined' ? null : parseDraft(localStorage.getItem(FBBOX_DRAFT_KEY))
  } catch {
    return null
  }
}

function writeDraft(): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (state.body.trim() === '') localStorage.removeItem(FBBOX_DRAFT_KEY)
    else localStorage.setItem(FBBOX_DRAFT_KEY, serializeDraft({ kind: state.kind, body: state.body }))
  } catch {
    /* 隐私模式写不进去：这次会话里仍然在 */
  }
}

/** 草稿随输入保存；关掉 Sheet 不丢。 */
export function setBody(value: string): void {
  state.body = value
  state.error = ''
  writeDraft()
}

export function setAttach(on: boolean): void {
  state.attach = on
}

export function setKind(kind: FeedbackKind): void {
  state.kind = kind
  writeDraft()
}

export function openFeedbackSheet(options: OpenOptions = {}): void {
  const draft = readDraft()
  state.receipt = null
  state.error = ''
  state.draftRestored = false
  if (options.body !== undefined) {
    state.kind = options.kind ?? 'bug'
    state.body = options.body
  } else if (state.body.trim() === '' && draft) {
    state.kind = options.kind ?? draft.kind
    state.body = draft.body
    state.draftRestored = true
  } else if (options.kind) {
    state.kind = options.kind
  }
  state.context = collectContext(options.targets ? { targets: options.targets } : {})
  state.open = true
}

export function closeFeedbackSheet(): void {
  if (state.sending) return
  state.open = false
}

/** 点一下快捷话：追加到输入框（已有内容时接在后面）。 */
export function addQuickTag(tag: string): void {
  const current = state.body.trim()
  setBody(current === '' ? tag : `${current}，${tag}`)
}

export async function submitFeedback(): Promise<boolean> {
  if (state.sending) return false
  const text = feedbackText(state.body)
  if (!text) {
    state.error = FBBOX_COPY.empty
    return false
  }
  state.sending = true
  state.error = ''
  try {
    state.receipt = await sendFeedback(state.kind, text, state.attach ? state.context : undefined)
    state.body = ''
    writeDraft()
    return true
  } catch (e) {
    state.error = e instanceof ApiError && e.status === 429 ? e.message : FBBOX_COPY.sendFailed
    return false
  } finally {
    state.sending = false
  }
}

/** 刷新红点：启动、回到前台、进「我的」时调用。失败静默（不打断学习）。 */
export async function refreshUnread(): Promise<void> {
  try {
    state.unread = (await listMyFeedback()).unread
  } catch {
    /* 没登录、没网：红点保持原样 */
  }
}

export function setUnread(count: number): void {
  state.unread = Math.max(0, Math.trunc(count))
}

export function useFeedbackBox() {
  return {
    state: readonly(state),
    hasUnread: computed(() => state.unread > 0),
    animate: computed(() => feedbackAllowed('motion')),
  }
}

/** 测试隔离。 */
export function __resetFeedbackBoxForTests(): void {
  Object.assign(state, {
    open: false,
    kind: 'bug',
    body: '',
    sending: false,
    error: '',
    context: {},
    receipt: null,
    unread: 0,
    draftRestored: false,
    attach: true,
  })
}
