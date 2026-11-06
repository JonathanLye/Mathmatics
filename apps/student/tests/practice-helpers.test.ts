import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeFeedback, computeInterstitial } from '@/components/practice/feedback'
import { nextItemInUnit, nextUnitId } from '@/components/practice/nextProblem'
import { frontierLayer } from '@/components/practice/practiceProgress'
import { keyLineLostOnTransition, keyLineOfTransition } from '@/components/practice/proofRail'
import { TYPING_MAX_MS, TYPING_STEP_MS, typingCuts, typingStride } from '@/components/practice/tutorTyping'
import { TOAST_ACTION_MS, TOAST_DEFAULT_MS, useToast } from '@/components/ui/useToast'
import { __resetClientForTests, backupDraft, configureClientForTests, consumeRewards, editLine, enterLayer } from '@/api/client'
import type { FetchLike } from '@/api/http'
import { useAttemptSession } from '@/composables/practice/useAttemptSession'
import { DRAFT_BACKUP_MS, useDrafts } from '@/composables/practice/useDrafts'
import type { DraftsHandle } from '@/composables/practice/useDrafts'
import { createMockState } from '@/mocks/attemptStates'
import { useAttempt } from '@/stores/attempt'
import type { PathItem, StudentPath } from '@/types/path'

describe('助教气泡打字：公式整段出现', () => {
  it('切点递增，最后一个等于全长', () => {
    const text = '先看 $a_n$ 再看'
    const cuts = typingCuts(text)
    expect(cuts[cuts.length - 1]).toBe(text.length)
    expect(cuts).toEqual([...cuts].sort((a, b) => a - b))
  })

  it('任何一个切点上，$ 都是成对的（不露半截 LaTeX）', () => {
    const text = '令 $\\varepsilon>0$，取 $N=\\lceil 1/\\varepsilon\\rceil$ 即可'
    for (const cut of typingCuts(text)) {
      const dollars = text.slice(0, cut).split('$').length - 1
      expect(dollars % 2).toBe(0)
    }
  })

  it('没闭合的 $ 不会卡住，一次走到结尾', () => {
    const text = '价格 $5'
    expect(typingCuts(text)).toEqual([1, 2, 3, text.length])
  })

  it('空文本没有切点', () => {
    expect(typingCuts('')).toEqual([])
  })

  it('再长的回答也在上限内打完', () => {
    const count = 5000
    const ticks = Math.ceil(count / typingStride(count))
    expect(ticks * TYPING_STEP_MS).toBeLessThanOrEqual(TYPING_MAX_MS + TYPING_STEP_MS)
    expect(typingStride(1)).toBe(1)
  })
})

function item(problemId: string, state: PathItem['state']): PathItem {
  return { problemId, state } as PathItem
}

describe('完成页「下一题」', () => {
  it('优先当前题后面的题', () => {
    const items = [item('a', 'todo'), item('b', 'done'), item('c', 'todo')]
    expect(nextItemInUnit(items, 'b')).toBe('c')
  })

  it('后面都做完了，回头找前面漏下的', () => {
    const items = [item('a', 'todo'), item('b', 'done'), item('c', 'done')]
    expect(nextItemInUnit(items, 'c')).toBe('a')
  })

  it('不会把刚做完的这道再给回去', () => {
    const items = [item('a', 'active')]
    expect(nextItemInUnit(items, 'a')).toBeNull()
  })

  it('本单元都做完了就是 null', () => {
    const items = [item('a', 'done'), item('b', 'done')]
    expect(nextItemInUnit(items, 'a')).toBeNull()
  })

  it('本题不在路径里时，从头找第一道没做完的', () => {
    const items = [item('a', 'done'), item('b', 'todo')]
    expect(nextItemInUnit(items, 'zzz')).toBe('b')
  })

  it('下一个单元跳过已完成和上锁的', () => {
    const path = {
      current: { id: 'u1' },
      units: [
        { id: 'u1', state: 'active', locked: false },
        { id: 'u2', state: 'done', locked: false },
        { id: 'u3', state: 'todo', locked: true },
        { id: 'u4', state: 'todo', locked: false },
      ],
    } as unknown as StudentPath
    expect(nextUnitId(path)).toBe('u4')
  })

  it('已经是最后一个单元时没有下一步', () => {
    const path = {
      current: { id: 'u1' },
      units: [{ id: 'u1', state: 'active', locked: false }],
    } as unknown as StudentPath
    expect(nextUnitId(path)).toBeNull()
  })
})

describe('轻提示的按钮', () => {
  afterEach(() => {
    useToast().hide()
    vi.useRealTimers()
  })

  it('带按钮的提示留得更久，到点连按钮一起收走', () => {
    vi.useFakeTimers()
    const toast = useToast()
    const run = vi.fn()
    toast.show('再试一次', { tone: 'warn', action: { label: '重试', run } })
    expect(toast.state.action?.label).toBe('重试')
    vi.advanceTimersByTime(TOAST_DEFAULT_MS + 1)
    expect(toast.state.message).toBe('再试一次')
    vi.advanceTimersByTime(TOAST_ACTION_MS)
    expect(toast.state.message).toBe('')
    expect(toast.state.action).toBeNull()
  })

  it('下一条普通提示不会继承上一条的按钮', () => {
    const toast = useToast()
    toast.show('再试一次', { action: { label: '重试', run: () => {} } })
    toast.show('已保存')
    expect(toast.state.action).toBeNull()
  })
})

describe('提交失败：弹带「重试」的提示，不是空白页', () => {
  function stubDrafts(): DraftsHandle {
    return { restoreDrafts: vi.fn(async () => {}), clearDefinition: vi.fn(async () => {}) } as unknown as DraftsHandle
  }

  afterEach(() => {
    __resetClientForTests()
    useAttempt().setMock('l1-active')
    useToast().hide()
  })

  it('断网：说人话；点重试用同一份内容再提交一次，成功后提示消失', async () => {
    const bodies: string[] = []
    let online = false
    const state = createMockState('l1-active')
    const fetchImpl: FetchLike = async (_url, init) => {
      bodies.push(String(init?.body ?? ''))
      if (!online) throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify({ state }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    configureClientForTests({ fetchImpl, mock: false })
    useAttempt().apply(state)
    const session = useAttemptSession(stubDrafts())
    const toast = useToast()

    await session.submitText('我的定义')

    expect(toast.state.message).toContain('网络')
    expect(toast.state.message).not.toContain('fetch')
    expect(toast.state.action?.label).toBe('重试')
    expect(session.phase.value).not.toBe('error')

    online = true
    // http 层自己会对断网重发一次，所以这里比较的是「再多一次」，不是总次数。
    const sentBefore = bodies.length
    const firstText = JSON.parse(bodies[0]).text
    const retry = toast.state.action?.run
    toast.hide()
    retry?.()
    await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(sentBefore))
    expect(JSON.parse(bodies[bodies.length - 1]).text).toBe(firstText)
    await vi.waitFor(() => expect(session.busy.value).toBe(false))
    expect(toast.state.message).toBe('')
  })

  it('服务端的英文报错不原样露给学生', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    configureClientForTests({ fetchImpl, mock: false })
    useAttempt().apply(createMockState('l1-active'))
    const session = useAttemptSession(stubDrafts())
    const toast = useToast()

    await session.submitText('我的定义')

    expect(toast.state.message).not.toMatch(/Internal|Server|Error/)
    expect(toast.state.message).toMatch(/[\u4e00-\u9fff]/)
    expect(toast.state.action?.label).toBe('重试')
  })
})

describe('回到已完成的层（/layers/{layer}/enter）', () => {
  afterEach(() => __resetClientForTests())

  it('还在做的层：第一个没完成、没跳过的启用层', () => {
    const layers = createMockState('l3-active').layers
    expect(frontierLayer(layers)).toBe('L3')
    // 回看第 1 层时，第 3 层在服务端状态里是 locked，但它还是最前沿。
    const reviewing = layers.map((l) => (l.layer === 'L3' ? { ...l, status: 'locked' as const } : l))
    expect(frontierLayer(reviewing)).toBe('L3')
    expect(frontierLayer(layers.map((l) => ({ ...l, status: 'done' as const })))).toBeNull()
  })

  it('mock 和引擎同一条规则：能回已完成的层，也能回最前沿，不能往没解锁的层跳', async () => {
    configureClientForTests({ mock: true })
    const start = createMockState('l3-active')
    const back = await enterLayer(start, 'L1')
    expect(back.currentLayer).toBe('L1')
    expect(back.layers.find((l) => l.layer === 'L3')?.status).toBe('locked')
    const again = await enterLayer(back, 'L3')
    expect(again.currentLayer).toBe('L3')
    expect(again.layers.find((l) => l.layer === 'L3')?.status).toBe('active')
    const blocked = await enterLayer(start, 'L5')
    expect(blocked.currentLayer).toBe('L3')
    expect(blocked.stateVersion).toBe(start.stateVersion)
  })

  it('真实接口：POST 对的路径，带 If-Match，rewards 能被取走', async () => {
    const start = createMockState('l3-active')
    const calls: Array<{ url: string; method?: string; ifMatch?: string }> = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url: String(url), method: init?.method, ifMatch: (init?.headers as Record<string, string>)?.['If-Match'] })
      return new Response(JSON.stringify({ state: { ...start, currentLayer: 'L1' }, rewards: { xp: 5 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    configureClientForTests({ fetchImpl, mock: false })
    const next = await enterLayer(start, 'L1')
    expect(next.currentLayer).toBe('L1')
    expect(calls[0].url).toContain('/attempts/' + start.attemptId + '/layers/L1/enter')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].ifMatch).toBe(String(start.stateVersion))
    expect(consumeRewards()?.xp).toBe(5)
  })

  it('回看完往前走不算做完一层：不出过场', () => {
    const prev = createMockState('l3-active')
    const reviewing = { ...prev, currentLayer: 'L1' as const, stateVersion: prev.stateVersion + 1 }
    const backToFrontier = { ...reviewing, currentLayer: 'L3' as const, stateVersion: reviewing.stateVersion + 1 }
    expect(computeInterstitial(prev, reviewing)).toBeNull()
    expect(computeInterstitial(reviewing, backToFrontier)).toBeNull()
    expect(computeFeedback(prev, reviewing)).toBeNull()
  })
})

describe('改写一行：rewards 和轨道节点', () => {
  afterEach(() => __resetClientForTests())

  function withEdit(keysDelta: number) {
    const prev = createMockState('l3-active')
    const lines = prev.steps?.lines ?? []
    const edited = lines[0]
    const next = {
      ...prev,
      stateVersion: prev.stateVersion + 1,
      budget: { ...prev.budget, keysOwn: prev.budget.keysOwn + keysDelta },
      steps: { lines: lines.map((l) => (l.lineId === edited.lineId ? { ...l, statement: '改过了' } : l)), canFinish: false },
    }
    return { prev, next, lineId: edited.lineId }
  }

  it('改写写到了关键步骤：面板算到改的这一行上，经验来自 rewards', () => {
    const { prev, next, lineId } = withEdit(1)
    expect(keyLineOfTransition(prev, next)).toBe(lineId)
    const panel = computeFeedback(prev, next, { xp: 10 } as never)
    expect(panel?.title).toBe('衔接上了')
    expect(panel?.lineId).toBe(lineId)
    expect(panel?.xp).toBe(10)
  })

  it('改写丢了关键步骤：这一行的节点要灭，不弹面板', () => {
    const { prev, next, lineId } = withEdit(-1)
    expect(keyLineLostOnTransition(prev, next)).toBe(lineId)
    expect(keyLineOfTransition(prev, next)).toBeNull()
    expect(computeFeedback(prev, next)).toBeNull()
  })

  it('真实接口的改写回来 { state, rewards }：rewards 能被取走', async () => {
    const start = createMockState('l3-active')
    const calls: Array<{ url: string; method?: string }> = []
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url: String(url), method: init?.method })
      return new Response(JSON.stringify({ state: start, rewards: { xp: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    configureClientForTests({ fetchImpl, mock: false })
    const lineId = start.steps?.lines[0].lineId ?? ''
    await editLine(start, lineId, { statement: '改过了', input: { provenance: 'keyboard', draftId: 'd' } })
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].url).toContain('/attempts/' + start.attemptId + '/lines/' + lineId)
    expect(consumeRewards()?.xp).toBe(10)
  })
})

describe('草稿备份（PUT /attempts/{id}/draft）', () => {
  afterEach(() => {
    __resetClientForTests()
    useAttempt().setMock('l1-active')
    vi.useRealTimers()
  })

  function captureDrafts() {
    const puts: Array<{ url: string; method?: string; body: { target: string; content: { text: string } } }> = []
    const fetchImpl: FetchLike = async (url, init) => {
      puts.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(null, { status: 204 })
    }
    configureClientForTests({ fetchImpl, mock: false })
    return puts
  }

  it('15 秒内同一落点只发最新一份', async () => {
    vi.useFakeTimers()
    const puts = captureDrafts()
    useAttempt().apply(createMockState('l1-active'))
    const attemptId = useAttempt().state.value.attemptId
    const drafts = useDrafts()
    drafts.saveDefinition('第一版')
    drafts.saveDefinition('第二版')
    expect(puts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(DRAFT_BACKUP_MS)
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toContain('/attempts/' + attemptId + '/draft')
    expect(puts[0].method).toBe('PUT')
    expect(puts[0].body).toEqual({ target: 'def', content: { text: '第二版' } })
  })

  it('提交成功后不再备份已经清掉的草稿', async () => {
    vi.useFakeTimers()
    const puts = captureDrafts()
    useAttempt().apply(createMockState('l1-active'))
    const attemptId = useAttempt().state.value.attemptId
    const drafts = useDrafts()
    drafts.saveDefinition('写完提交了')
    void drafts.clearDefinition(attemptId)
    await vi.advanceTimersByTimeAsync(DRAFT_BACKUP_MS)
    expect(puts).toHaveLength(0)
  })

  it('离开页面时把还没发的发掉；备份失败不抛错', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('Failed to fetch')
    }
    configureClientForTests({ fetchImpl, mock: false })
    useAttempt().apply(createMockState('l1-active'))
    const drafts = useDrafts()
    drafts.saveDefinition('断网时写的')
    expect(() => drafts.stopBackup()).not.toThrow()
    await expect(backupDraft('a', 'def', { text: 'x' })).rejects.toBeTruthy()
  })

  it('mock 模式不发请求', async () => {
    const calls: string[] = []
    configureClientForTests({ fetchImpl: async (url) => { calls.push(String(url)); return new Response(null, { status: 204 }) }, mock: true })
    await backupDraft('a', 'def', { text: 'x' })
    expect(calls).toHaveLength(0)
  })
})
