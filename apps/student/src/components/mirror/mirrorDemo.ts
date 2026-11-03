/**
 * 教师镜像/回放组件的 mock 事件序列（issue #43 A 侧子集，供 story / 单测 / 本地演示）。
 *
 * 典型作答：打开应用 → 进做题页 → L1 提交定义（通过）→ L3 写两行 → 卡住求助 → 离开 30 秒回来 → 提交总结。
 * 事件类型与 payload 字段按 08 §3 事件目录；seq/tsServer 按 08 §2 信封（回放排序以 seq 为准）。
 * 这里只放 mock 数据，不冒充服务端；真实来源见 06 §6 的 /teacher/attempts/{id}/events 与 SSE。
 */
import type { MirrorEvent } from './mirror'
import { buildTimeline, type MirrorTimeline } from './mirror'

function iso(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString()
}

const baseMs = Date.parse('2026-11-03T12:01:00.000Z')
const minute = 60 * 1000

/** 一条可复用的典型作答事件序列（约 18 分钟）。 */
export const MIRROR_DEMO_EVENTS: readonly MirrorEvent[] = [
  {
    seq: 1,
    type: 'app.open',
    tsServer: iso(baseMs, 0),
    tsClient: iso(baseMs, -800),
    payload: { entry: 'cold' },
  },
  {
    seq: 2,
    type: 'nav.page',
    tsServer: iso(baseMs, 2 * 1000),
    layer: null,
    payload: { page: 'practice', from: 'home' },
  },
  {
    seq: 3,
    type: 'def.submit',
    tsServer: iso(baseMs, 2 * minute),
    layer: 'L1',
    payload: { lineId: '11111111-1111-4111-8111-111111111111', n: 1, pass: true, path: 'rule+jev' },
  },
  {
    seq: 4,
    type: 'line.submit',
    tsServer: iso(baseMs, 11 * minute),
    layer: 'L3',
    payload: {
      lineId: '22222222-2222-4222-8222-222222222222',
      n: 1,
      provenance: 'ink',
      hasJust: true,
      cls: 'K1',
      keys: ['K1'],
      newKeys: ['K1'],
      path: 'rule',
    },
  },
  {
    seq: 5,
    type: 'line.submit',
    tsServer: iso(baseMs, 14 * minute),
    layer: 'L3',
    payload: {
      lineId: '33333333-3333-4333-8333-333333333333',
      n: 2,
      provenance: 'keyboard',
      hasJust: false,
      cls: 'K2',
      keys: ['K2'],
      newKeys: ['K2'],
      path: 'rule+jev',
    },
  },
  {
    seq: 6,
    type: 'help.request',
    tsServer: iso(baseMs, 15 * minute + 20 * 1000),
    layer: 'L3',
    payload: { helpId: '44444444-4444-4444-8444-444444444444', intent: 'stuck', routed: 'stuck', routedBy: 'rule', conf: 0.92, textChars: 0 },
  },
  {
    seq: 7,
    type: 'integ.visibility',
    tsServer: iso(baseMs, 16 * minute),
    payload: { state: 'hidden' },
  },
  {
    seq: 8,
    type: 'integ.visibility',
    tsServer: iso(baseMs, 16 * minute + 30 * 1000),
    payload: { state: 'visible', awayMs: 30 * 1000 },
  },
  {
    seq: 9,
    type: 'summary.submit',
    tsServer: iso(baseMs, 18 * minute),
    layer: 'L6',
    payload: { missing: [], followupAsked: false, pass: true },
  },
]

/** 返回 demo 事件的副本（组件/story 修改不会污染模块常量）。 */
export function createMirrorDemoEvents(): MirrorEvent[] {
  return MIRROR_DEMO_EVENTS.map((event) => ({
    ...event,
    payload: event.payload ? { ...event.payload } : event.payload,
  }))
}

/** demo 事件对应的时间轴（回放滑块 / 快照测试用）。 */
export function createMirrorDemoTimeline(): MirrorTimeline {
  return buildTimeline(MIRROR_DEMO_EVENTS)
}
