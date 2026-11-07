/**
 * 小方信箱的演示数据（mock 模式）：和真实服务端同样的规则——提交得编号、开发者回复让红点出现、
 * 打开即已读、庆祝事件只播一次、已关闭不能再回复。真实模式不会用到这里。
 */
import type { FeedbackKind } from '@/types/attempt'
import type {
  FeedbackContext,
  FeedbackList,
  FeedbackListItem,
  FeedbackMessage,
  FeedbackReceipt,
  FeedbackStatus,
  FeedbackThread,
} from '@/types/feedbackbox'

interface MockRow {
  id: string
  refNo: number
  kind: FeedbackKind
  status: FeedbackStatus
  closeReason: FeedbackThread['closeReason']
  confirmed: boolean
  unread: boolean
  event: FeedbackThread['event']
  createdAt: string
  lastActivityAt: string
  messages: FeedbackMessage[]
  context?: FeedbackContext
}

let rows: MockRow[] = []
let nextRef = 1
let counter = 0

const uid = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const preview = (text: string): string => Array.from(text).slice(0, 60).join('')
const now = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString()

/** 演示用的初始反馈：一条等你补充（出红点）、一条刚被确认复现（带庆祝事件）。 */
export function resetMockFeedback(seed = true): void {
  rows = []
  nextRef = 1
  counter = 0
  if (!seed) return
  const a = uid()
  rows.push({
    id: a,
    refNo: nextRef++,
    kind: 'bug',
    status: 'need_info',
    closeReason: null,
    confirmed: false,
    unread: true,
    event: null,
    createdAt: now(-3 * 3600_000),
    lastActivityAt: now(-20 * 60_000),
    messages: [
      { id: a, from: 'me', body: '做第 3 步的时候，分数线打不出来。', createdAt: now(-3 * 3600_000) },
      { id: uid(), from: 'dev', body: '收到啦！你是用手写还是键盘？用的什么手机？', createdAt: now(-20 * 60_000) },
    ],
  })
  const b = uid()
  rows.push({
    id: b,
    refNo: nextRef++,
    kind: 'bug',
    status: 'open',
    closeReason: null,
    confirmed: true,
    unread: true,
    event: 'confirmed',
    createdAt: now(-26 * 3600_000),
    lastActivityAt: now(-2 * 3600_000),
    messages: [
      { id: b, from: 'me', body: '点「求助」之后页面卡住了。', createdAt: now(-26 * 3600_000) },
      { id: uid(), from: 'dev', body: '我们复现了这个问题，正在处理。谢谢你帮小方抓到它！', createdAt: now(-2 * 3600_000) },
    ],
  })
}
resetMockFeedback()

const unreadCount = (): number => rows.filter((r) => r.unread).length

export function mockListFeedback(): FeedbackList {
  const items: FeedbackListItem[] = [...rows]
    .sort((x, y) => y.lastActivityAt.localeCompare(x.lastActivityAt))
    .map((r) => {
      const lastDev = [...r.messages].reverse().find((m) => m.from === 'dev')
      return {
        id: r.id,
        refNo: r.refNo,
        kind: r.kind,
        status: r.status,
        closeReason: r.closeReason ?? null,
        preview: preview(r.messages[0]?.body ?? ''),
        lastReply: lastDev ? preview(lastDev.body) : null,
        confirmed: r.confirmed,
        unread: r.unread,
        createdAt: r.createdAt,
        lastActivityAt: r.lastActivityAt,
      }
    })
  return { items, unread: unreadCount() }
}

export function mockSubmitFeedback(kind: FeedbackKind, body: string, context?: FeedbackContext): FeedbackReceipt {
  const id = uid()
  const refNo = nextRef++
  rows.push({
    id,
    refNo,
    kind,
    status: 'new',
    closeReason: null,
    confirmed: false,
    unread: false,
    event: null,
    createdAt: now(),
    lastActivityAt: now(),
    messages: [{ id, from: 'me', body, createdAt: now() }],
    ...(context ? { context } : {}),
  })
  return { id, refNo }
}

export class MockFeedbackError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function mockGetFeedback(id: string): FeedbackThread {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new MockFeedbackError(404, 'NOT_FOUND', '这条反馈不存在')
  const thread: FeedbackThread = {
    id: row.id,
    refNo: row.refNo,
    kind: row.kind,
    status: row.status,
    closeReason: row.closeReason ?? null,
    confirmed: row.confirmed,
    event: row.event ?? null,
    createdAt: row.createdAt,
    messages: row.messages.map((m) => ({ ...m })),
  }
  row.unread = false
  row.event = null
  return thread
}

export function mockReplyFeedback(id: string, body: string): FeedbackMessage {
  const row = rows.find((r) => r.id === id)
  if (!row) throw new MockFeedbackError(404, 'NOT_FOUND', '这条反馈不存在')
  if (row.status === 'closed') throw new MockFeedbackError(409, 'FEEDBACK_CLOSED', '这条反馈已经关闭了，可以再写一条新的')
  if (row.status === 'need_info' || row.status === 'resolved') row.status = 'open'
  const message: FeedbackMessage = { id: uid(), from: 'me', body, createdAt: now() }
  row.messages.push(message)
  row.lastActivityAt = message.createdAt
  return { ...message }
}
