/**
 * #43 镜像页接线：SSE 控制器、只读视图选择、路径→hash 路由（≥10 例）。
 * 只用 fake EventSource + 注入计时器，不启动浏览器。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AttemptState } from '@/types/attempt'
import type { MirrorEventSourceLike, MirrorStreamStatusInfo } from '@/components/mirror/mirrorSse'
import {
  buildMirrorStreamUrl,
  createMirrorStream,
  isReadonlyAttemptState,
  parseMirrorStateMessage,
  reconnectDelay,
  shouldApplyMirrorState,
} from '@/components/mirror/mirrorSse'
import {
  MIRROR_BANNER,
  buildMirrorViewModel,
  mirrorLayerLabel,
  mirrorNoteKindLabel,
  mirrorSelfcheckStatusLabel,
  mirrorStatusLabel,
  mirrorTransferStatusLabel,
} from '@/components/mirror/mirrorView'
import { hashMirrorRedirect } from '@/components/mirror/mirrorRoute'
import { isValidAttemptId, isValidMirrorToken } from '@/components/mirror/mirror'

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'mirror_token_abcdef123456'

function makeState(patch: Partial<AttemptState> = {}): AttemptState {
  return {
    attemptId: ATTEMPT,
    stateVersion: 7,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem: {
      problemId: 'epsN',
      version: 1,
      title: '数列极限 · ε-N',
      stem: '用 $\\varepsilon$-$N$ 定义证明极限。',
      chapter: '第二章 数列极限',
      keyCount: 4,
    },
    currentLayer: 'L3',
    layers: [
      { layer: 'L1', title: '记忆核验', status: 'done', enabled: true, skippable: true },
      { layer: 'L2', title: '证明骨架', status: 'done', enabled: true, skippable: true },
      { layer: 'L3', title: '构造与推导', status: 'active', enabled: true, skippable: false },
      { layer: 'L4', title: '自检', status: 'locked', enabled: true, skippable: true },
      { layer: 'L5', title: '迁移题', status: 'locked', enabled: false, skippable: true },
      { layer: 'L6', title: '总结', status: 'locked', enabled: true, skippable: false },
    ],
    budget: { revealUsed: 0.5, revealMax: 2, keysOwn: 1, keysTotal: 4 },
    def: { task: '写出定义。', last: '任取 $\\varepsilon>0$，存在 $N$。', submissions: 1 },
    frame: { task: '写出骨架。', template: '取 $N=$＿。', last: '先放大，再取 N。', templateShown: true },
    steps: {
      lines: [
        { lineId: 'line-1', n: 1, statement: '$|a_n-3|=\\frac{5}{n+2}$', justification: '通分', provenance: 'ink', keys: [], inkId: null },
      ],
      canFinish: false,
    },
    notes: [
      { noteId: 'note-1', kind: 'annotation', who: '批注', text: '这一行的依据是哪条？', lineId: 'line-1', level: null, cost: null, lessonConceptId: null, at: '2026-11-04T00:00:00.000Z' },
      { noteId: 'note-2', kind: 'hint', who: 'H1', text: '先把式子写成只含 n 的量。', lineId: null, level: 'H1', cost: 0, lessonConceptId: null, at: '2026-11-04T00:01:00.000Z' },
    ],
    help: { hintAvailable: true, exhausted: false, flagged: false },
    integrity: { mode: 'practice', locked: false, warnings: 0 },
    serverTime: '2026-11-04T00:02:00.000Z',
    ...patch,
  }
}

class FakeEventSource implements MirrorEventSourceLike {
  static instances: FakeEventSource[] = []
  readonly url: string
  closed = false
  private listeners = new Map<string, Array<(event: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function resetFake(): void {
  FakeEventSource.instances = []
}

interface Harness {
  statuses: MirrorStreamStatusInfo[]
  states: AttemptState[]
  queue: Array<{ id: number; fn: () => void; ms: number }>
  runNextTimer: () => void
  handle: ReturnType<typeof createMirrorStream>
}

function makeHarness(options: { maxReconnectAttempts?: number; authSuspectAttempts?: number; onState?: (state: AttemptState) => void } = {}): Harness {
  resetFake()
  const statuses: MirrorStreamStatusInfo[] = []
  const states: AttemptState[] = []
  const queue: Array<{ id: number; fn: () => void; ms: number }> = []
  let nextId = 1
  const handle = createMirrorStream({
    url: buildMirrorStreamUrl(ATTEMPT, TOKEN),
    createEventSource: (url) => new FakeEventSource(url),
    onState: (state) => {
      states.push(state)
      options.onState?.(state)
    },
    onStatus: (info) => statuses.push(info),
    setTimeoutImpl: (fn, ms) => {
      const id = nextId
      nextId += 1
      queue.push({ id, fn, ms })
      return id
    },
    clearTimeoutImpl: (id) => {
      const index = queue.findIndex((item) => item.id === id)
      if (index >= 0) queue.splice(index, 1)
    },
    maxReconnectAttempts: options.maxReconnectAttempts ?? 6,
    authSuspectAttempts: options.authSuspectAttempts ?? 2,
    reconnectBaseMs: 800,
    reconnectMaxMs: 8000,
  })
  return {
    statuses,
    states,
    queue,
    runNextTimer: () => {
      const item = queue.shift()
      if (!item) throw new Error('no scheduled reconnect')
      item.fn()
    },
    handle,
  }
}

function stateFrame(version: number, data: AttemptState = makeState({ stateVersion: version }), eventId = String(version)): { data: string; lastEventId: string } {
  return { data: JSON.stringify(data), lastEventId: eventId }
}

describe('#43 镜像 SSE：URL / 退避 / 状态校验', () => {
  it('buildMirrorStreamUrl 编码 attempt 与 token', () => {
    expect(buildMirrorStreamUrl(ATTEMPT, TOKEN)).toBe('/api/v1/teacher/attempts/' + ATTEMPT + '/stream?token=' + TOKEN)
    expect(buildMirrorStreamUrl('a b', 'x&y')).toBe('/api/v1/teacher/attempts/a%20b/stream?token=x%26y')
  })

  it('reconnectDelay 指数增长并封顶', () => {
    expect(reconnectDelay(1, 800, 8000)).toBe(800)
    expect(reconnectDelay(2, 800, 8000)).toBe(1600)
    expect(reconnectDelay(3, 800, 8000)).toBe(3200)
    expect(reconnectDelay(10, 800, 8000)).toBe(8000)
  })

  it('isReadonlyAttemptState 拒绝坏帧，接受学生视图 AttemptState', () => {
    expect(isReadonlyAttemptState(makeState())).toBe(true)
    expect(isReadonlyAttemptState(null)).toBe(false)
    expect(isReadonlyAttemptState({})).toBe(false)
    expect(isReadonlyAttemptState({ attemptId: ATTEMPT, stateVersion: 1 })).toBe(false)
    expect(isReadonlyAttemptState({ attemptId: ATTEMPT, stateVersion: 1, problem: { title: 't' }, layers: [] })).toBe(true)
  })

  it('parseMirrorStateMessage 解析 JSON；坏 JSON/非 state 返回 null', () => {
    expect(parseMirrorStateMessage(JSON.stringify(makeState()))?.attemptId).toBe(ATTEMPT)
    expect(parseMirrorStateMessage('not-json')).toBeNull()
    expect(parseMirrorStateMessage('{"hello":1}')).toBeNull()
    expect(parseMirrorStateMessage(undefined)).toBeNull()
  })

  it('shouldApplyMirrorState 只接受版本不倒退的帧', () => {
    const v7 = makeState()
    const v8 = makeState({ stateVersion: 8 })
    const v6 = makeState({ stateVersion: 6 })
    expect(shouldApplyMirrorState(null, v7)).toBe(true)
    expect(shouldApplyMirrorState(v7, v8)).toBe(true)
    expect(shouldApplyMirrorState(v7, v7)).toBe(true)
    expect(shouldApplyMirrorState(v8, v6)).toBe(false)
  })

  it('token/attempt 校验沿用 mirror.ts（页面入口同口径）', () => {
    expect(isValidMirrorToken(TOKEN)).toBe(true)
    expect(isValidMirrorToken('short')).toBe(false)
    expect(isValidAttemptId(ATTEMPT)).toBe(true)
    expect(isValidAttemptId('bad attempt')).toBe(false)
  })
})

describe('#43 镜像 SSE：连接/重连/只读状态合并', () => {
  it('state 帧 → onState 渲染 + 状态已连接，并记录 lastEventId', () => {
    const h = makeHarness()
    expect(FakeEventSource.instances).toHaveLength(1)
    const es = FakeEventSource.instances[0] as FakeEventSource
    es.emit('state', stateFrame(7))
    expect(h.states).toHaveLength(1)
    expect(h.states[0]?.stateVersion).toBe(7)
    expect(h.handle.status()).toBe('connected')
    expect(h.handle.lastEventId()).toBe('7')
    h.handle.close()
  })

  it('旧版本 state 帧被忽略（只渲染最新状态）', () => {
    const h = makeHarness()
    const es = FakeEventSource.instances[0] as FakeEventSource
    es.emit('state', stateFrame(9))
    es.emit('state', stateFrame(5))
    expect(h.states.map((state) => state.stateVersion)).toEqual([9])
    h.handle.close()
  })

  it('ping 只维持连接，不产生 state', () => {
    const h = makeHarness()
    const es = FakeEventSource.instances[0] as FakeEventSource
    es.emit('ping', {})
    expect(h.states).toHaveLength(0)
    expect(h.handle.status()).toBe('connected')
    h.handle.close()
  })

  it('断线 → 重连中（网络），按退避时间新建 EventSource 并恢复', () => {
    const h = makeHarness()
    const first = FakeEventSource.instances[0] as FakeEventSource
    first.emit('error', {})
    expect(h.handle.status()).toBe('reconnecting')
    expect(h.statuses.at(-1)?.detail).toBe('network')
    expect(h.queue[0]?.ms).toBe(800)
    h.runNextTimer()
    expect(FakeEventSource.instances).toHaveLength(2)
    const second = FakeEventSource.instances[1] as FakeEventSource
    second.emit('state', stateFrame(8))
    expect(h.states.at(-1)?.stateVersion).toBe(8)
    expect(h.handle.status()).toBe('connected')
    expect(h.handle.attempts()).toBe(0)
    h.handle.close()
  })

  it('首连连续失败（从未收到 state）→ auth 可疑提示，页面据此展示过期/无权限', () => {
    const h = makeHarness({ authSuspectAttempts: 2 })
    const first = FakeEventSource.instances[0] as FakeEventSource
    first.emit('error', {})
    expect(h.statuses.at(-1)?.detail).toBe('network')
    h.runNextTimer()
    const second = FakeEventSource.instances[1] as FakeEventSource
    second.emit('error', {})
    expect(h.handle.status()).toBe('reconnecting')
    expect(h.statuses.at(-1)?.detail).toBe('auth')
    h.handle.close()
  })

  it('超过最大重连次数 → failed（从未连上则按 auth 提示）', () => {
    const h = makeHarness({ maxReconnectAttempts: 2, authSuspectAttempts: 2 })
    ;(FakeEventSource.instances[0] as FakeEventSource).emit('error', {})
    h.runNextTimer()
    ;(FakeEventSource.instances[1] as FakeEventSource).emit('error', {})
    h.runNextTimer()
    ;(FakeEventSource.instances[2] as FakeEventSource).emit('error', {})
    expect(h.handle.status()).toBe('failed')
    expect(h.statuses.at(-1)?.detail).toBe('auth')
    h.handle.close()
  })

  it('close() 取消挂起重连，不再新建连接', () => {
    const h = makeHarness()
    ;(FakeEventSource.instances[0] as FakeEventSource).emit('error', {})
    expect(h.queue).toHaveLength(1)
    h.handle.close()
    expect(h.queue).toHaveLength(0)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('坏 data 帧不打断镜像', () => {
    const h = makeHarness()
    const es = FakeEventSource.instances[0] as FakeEventSource
    es.emit('state', { data: 'not-json', lastEventId: '3' })
    es.emit('state', { data: '{"attemptId":"x"}', lastEventId: '4' })
    expect(h.states).toHaveLength(0)
    h.handle.close()
  })
})

describe('#43 镜像只读视图（mirrorView）', () => {
  it('把 AttemptState 映射成只读视图：题面/层/定义/骨架/行/notes/自检/总结/完成', () => {
    const state = makeState({
      selfcheck: {
        items: [
          { itemId: 'SC1', question: '依据是什么？', status: 'accepted', answer: '由定义' },
          { itemId: 'SC2', question: 'N 起什么作用？', status: 'open' },
        ],
      },
      transfer: { status: 'active', stem: '迁移题面', childAttemptId: null },
      summary: { questions: ['第一问', '第二问'], answers: ['第一答', ''] },
      completion: { done: true, independence: 0.75, leanCard: { theorems: ['Filter.Tendsto'], steps: [{ keyId: 'K1', label: '化简' }] } },
    })
    const view = buildMirrorViewModel(state)
    expect(view).not.toBeNull()
    expect(view?.title).toBe('数列极限 · ε-N')
    expect(view?.layerLabel).toContain('第 3 层')
    expect(view?.definition?.last).toContain('任取')
    expect(view?.frame?.templateShown).toBe(true)
    expect(view?.lines).toHaveLength(1)
    expect(view?.notes).toHaveLength(2)
    expect(view?.notes[0]?.kindLabel).toBe('批注')
    expect(view?.selfcheck.map((row) => row.statusLabel)).toEqual(['已通过', '待回答'])
    expect(view?.transfer?.statusLabel).toBe('进行中')
    expect(view?.summary?.questions).toHaveLength(2)
    expect(view?.completion?.theorems).toEqual(['Filter.Tendsto'])
    expect(view?.completion?.steps).toEqual(['化简'])
    expect(view?.budget.keysTotal).toBe(4)
  })

  it('视图只含展示字段（无动作/输入回调），纯函数不产生副作用', () => {
    const state = makeState()
    const view = buildMirrorViewModel(state)
    expect(view).not.toBeNull()
    const values = Object.values(view ?? {})
    expect(values.some((value) => typeof value === 'function')).toBe(false)
    expect(JSON.stringify(view)).not.toContain('token')
    expect(MIRROR_BANNER).toContain('只读')
  })

  it('缺 problem / null state → null（页面显示连接占位，不抛错）', () => {
    expect(buildMirrorViewModel(null)).toBeNull()
    expect(buildMirrorViewModel({ ...makeState(), problem: undefined } as unknown as AttemptState)).toBeNull()
  })

  it('层/状态/批注/自检/迁移的中文标签', () => {
    expect(mirrorLayerLabel('L4')).toContain('第 4 层')
    expect(mirrorStatusLabel('completed')).toBe('已完成')
    expect(mirrorNoteKindLabel('annotation')).toBe('批注')
    expect(mirrorSelfcheckStatusLabel('followup')).toBe('追问中')
    expect(mirrorTransferStatusLabel('skipped')).toBe('已跳过')
  })
})

describe('#43 /s/mirror 路径 → hash 路由', () => {
  it('根路径 /s/mirror 保留查询参数跳到 hash 页面', () => {
    expect(hashMirrorRedirect('/s/mirror', '?attempt=a&token=t')).toBe('/#/pages/mirror/index?attempt=a&token=t')
  })

  it('支持子路径部署与末尾斜杠', () => {
    expect(hashMirrorRedirect('/proof-gym/s/mirror/', '?attempt=a')).toBe('/proof-gym/#/pages/mirror/index?attempt=a')
  })

  it('非镜像路径返回 null（不误跳）', () => {
    expect(hashMirrorRedirect('/', '')).toBeNull()
    expect(hashMirrorRedirect('/pages/home/index', '')).toBeNull()
    expect(hashMirrorRedirect('/s/mirror-extra', '')).toBeNull()
  })
})
