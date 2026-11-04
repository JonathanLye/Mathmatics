/**
 * 前端事件信封（08 §2 / contracts/events.schema.json 的 $defs/ClientEvent）。
 *
 * 只定义前端能上报（source=student）的字段与类型；服务端字段（seq/tsServer/userAnon/...）由服务端补全。
 * 事件类型严格取自 08 事件目录，不发明新类型。
 */
import { isUuid, uuidv7 } from './ids'

/** 本 SDK 会上报的 ClientEvent 类型（08 §3 目录里 source=学生端 且与本 issue 相关）。 */
export type IntegrityEventType =
  | 'integ.visibility'
  | 'integ.blur'
  | 'integ.fullscreen'
  | 'integ.copy'
  | 'integ.cut'
  | 'integ.contextmenu'
  | 'integ.shortcut'
  | 'integ.multitab'
  | 'integ.network'
  | 'paste'
  | 'nav.page'
  | 'sys.error'

/** ClientEvent：前端 POST /api/v1/events/batch 的单条事件（contracts/events.schema.json $defs/ClientEvent）。 */
export interface ClientEvent {
  id: string
  type: IntegrityEventType
  tsClient: string
  sessionId: string
  deviceId: string
  clientSeq: number
  attemptId?: string
  layer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | null
  payload: Record<string, unknown>
}

export interface EventContext {
  sessionId: string
  deviceId: string
  attemptId?: string | null
  layer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | null
  mode?: 'practice' | 'test' | null
  problemId?: string | null
}

export const EVENTS_BATCH_PATH = '/api/v1/events/batch'
/** 契约：每批 ≤ 100 条、≤ 256KB（openapi /events/batch）。 */
export const MAX_BATCH_EVENTS = 100

/** 生成一条 ClientEvent。clientSeq 在同一前端会话内递增（用于发现丢包）。 */
export function createClientEvent(
  type: IntegrityEventType,
  payload: Record<string, unknown>,
  context: EventContext,
  clientSeq: number,
  now: () => number = Date.now,
): ClientEvent {
  const event: ClientEvent = {
    id: uuidv7(now()),
    type,
    tsClient: new Date(now()).toISOString(),
    sessionId: context.sessionId,
    deviceId: context.deviceId,
    clientSeq,
    payload,
  }
  if (context.attemptId) event.attemptId = context.attemptId
  if (context.layer !== undefined) event.layer = context.layer ?? null
  return event
}

/** 创建一个「自增 clientSeq + 固定上下文」的 reporter，供采集器调用。 */
export function createEventReporter(
  getContext: () => EventContext,
  options: { now?: () => number; startSeq?: number } = {},
): (type: IntegrityEventType, payload?: Record<string, unknown>) => ClientEvent {
  const now = options.now ?? Date.now
  let seq = options.startSeq ?? 0
  return (type, payload = {}) => {
    seq += 1
    return createClientEvent(type, payload, getContext(), seq, now)
  }
}

/** 校验一条 ClientEvent 的必要字段（单测/发送前兜底用，避免把坏事件发出去）。 */
export function isValidClientEvent(event: ClientEvent): boolean {
  return (
    isUuid(event.id) &&
    typeof event.type === 'string' &&
    typeof event.tsClient === 'string' &&
    isUuid(event.sessionId) &&
    isUuid(event.deviceId) &&
    Number.isInteger(event.clientSeq) &&
    event.clientSeq >= 1 &&
    typeof event.payload === 'object' &&
    event.payload !== null
  )
}
