// 小方信箱（15 号文档）的前端类型。契约真源：packages/contracts/openapi.yaml 的 Feedback* 模式。
import type { FeedbackKind } from './attempt'

export type FeedbackStatus = 'new' | 'open' | 'need_info' | 'resolved' | 'closed'
export type FeedbackCloseReason = 'fixed' | 'duplicate' | 'wontfix' | 'no_repro'

/** 探针上下文（FeedbackContext）；全部可选。绝不放作答正文、输入内容、答案。 */
export interface FeedbackContext {
  route?: string
  pageName?: string
  problemId?: string
  attemptId?: string
  layer?: string
  mode?: 'practice' | 'test'
  stepNo?: number
  targets?: string[]
  app?: { version?: string; sha?: string }
  env?: { os?: string; browser?: string; viewport?: string; dpr?: number; theme?: 'light' | 'dark'; online?: boolean; motion?: boolean }
  errors?: Array<{ name?: string; message: string; where?: string; at?: number }>
  breadcrumbs?: Array<{ kind: 'nav' | 'tap' | 'api'; text: string; status?: number; ms?: number; reqId?: string; at?: number }>
}

export interface FeedbackReceipt {
  id: string
  refNo: number
}

export interface FeedbackListItem {
  id: string
  refNo: number
  kind: FeedbackKind
  status: FeedbackStatus
  closeReason?: FeedbackCloseReason | null
  preview: string
  lastReply?: string | null
  confirmed: boolean
  unread: boolean
  createdAt: string
  lastActivityAt: string
}

export interface FeedbackMessage {
  id: string
  from: 'me' | 'dev'
  body: string
  createdAt: string
}

export interface FeedbackThread {
  id: string
  refNo: number
  kind: FeedbackKind
  status: FeedbackStatus
  closeReason?: FeedbackCloseReason | null
  confirmed: boolean
  /** 一次性庆祝事件：读后服务端清空。 */
  event?: 'confirmed' | 'resolved' | null
  createdAt: string
  messages: FeedbackMessage[]
}

export interface FeedbackList {
  items: FeedbackListItem[]
  unread: number
}
