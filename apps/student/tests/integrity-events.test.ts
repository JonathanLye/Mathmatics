import { describe, expect, it } from 'vitest'
import {
  createClientEvent,
  createEventReporter,
  isValidClientEvent,
  MAX_BATCH_EVENTS,
  type EventContext,
} from '@/integrity/events'
import { isUuid, uuidv7 } from '@/integrity/ids'

const CONTEXT: EventContext = {
  sessionId: '00000000-0000-7000-8000-000000000001',
  deviceId: '00000000-0000-7000-8000-000000000002',
  attemptId: '11111111-1111-4111-8111-111111111111',
  layer: 'L3',
}

const NOW = Date.parse('2026-11-04T00:00:00.000Z')

describe('#27 uuid/事件信封（08 §2）', () => {
  it('uuidv7 是合法 uuid、通过 isUuid 校验', () => {
    const id = uuidv7(NOW)
    expect(isUuid(id)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(null)).toBe(false)
  })

  it('uuidv7 带 version 7 与 variant 8/9/a/b 位，且前 48 位就是毫秒时间戳', () => {
    const id = uuidv7(NOW)
    expect(id[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(id[19])
    const ts = parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
    expect(ts).toBe(NOW)
  })

  it('createClientEvent 补齐 ClientEvent 必填字段（id/tsClient/sessionId/deviceId/clientSeq/payload）', () => {
    const event = createClientEvent('integ.visibility', { state: 'hidden' }, CONTEXT, 1, () => NOW)
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(isUuid(event.id)).toBe(true)
    expect(event.type).toBe('integ.visibility')
    expect(event.tsClient).toBe('2026-11-04T00:00:00.000Z')
    expect(event.sessionId).toBe(CONTEXT.sessionId)
    expect(event.deviceId).toBe(CONTEXT.deviceId)
    expect(event.clientSeq).toBe(1)
    expect(event.payload).toEqual({ state: 'hidden' })
    expect(event.attemptId).toBe(CONTEXT.attemptId)
    expect(event.layer).toBe('L3')
    expect(isValidClientEvent(event)).toBe(true)
  })

  it('reporter 的 clientSeq 单调递增且 payload 默认为空对象', () => {
    const report = createEventReporter(() => CONTEXT, { now: () => NOW })
    const first = report('integ.copy', { chars: 3 })
    const second = report('paste')
    expect(first.clientSeq).toBe(1)
    expect(second.clientSeq).toBe(2)
    expect(second.payload).toEqual({})
  })

  it('没有 attempt/layer 时不带这两个可选字段', () => {
    const event = createClientEvent('integ.network', { online: false }, { sessionId: CONTEXT.sessionId, deviceId: CONTEXT.deviceId }, 1, () => NOW)
    expect(event.attemptId).toBeUndefined()
    expect(event.layer).toBeUndefined()
  })

  it('事件 id 每次生成不同（去重靠 id）', () => {
    const a = uuidv7(NOW)
    const b = uuidv7(NOW)
    expect(a).not.toBe(b)
  })

  it('isValidClientEvent 拒绝缺字段/坏 id', () => {
    const event = createClientEvent('integ.visibility', { state: 'visible' }, CONTEXT, 1, () => NOW)
    expect(isValidClientEvent({ ...event, id: 'x' })).toBe(false)
    expect(isValidClientEvent({ ...event, clientSeq: 0 })).toBe(false)
    expect(isValidClientEvent({ ...event, payload: null as unknown as Record<string, unknown> })).toBe(false)
  })

  it('契约批量上限 100（openapi /events/batch）', () => {
    expect(MAX_BATCH_EVENTS).toBe(100)
  })
})
