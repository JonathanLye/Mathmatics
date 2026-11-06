import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureClientForTests, __resetClientForTests } from '@/api/client'
import type { FetchLike } from '@/api/http'
import { useAttemptSession } from '@/composables/practice/useAttemptSession'
import type { DraftsHandle } from '@/composables/practice/useDrafts'
import { createMockState } from '@/mocks/attemptStates'
import { createEmptyAttemptState, setPendingAttempt, useAttempt } from '@/stores/attempt'

function stubDrafts(): DraftsHandle {
  return { restoreDrafts: vi.fn(async () => {}), clearDefinition: vi.fn(async () => {}) } as unknown as DraftsHandle
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 真实模式：fetch 依次返回给定响应（用完后重复最后一个）。 */
function realClient(responses: Array<() => Response>): { calls: string[] } {
  const calls: string[] = []
  let i = 0
  const fetchImpl: FetchLike = async (url) => {
    calls.push(String(url))
    const make = responses[Math.min(i, responses.length - 1)]
    i += 1
    return make()
  }
  configureClientForTests({ fetchImpl, mock: false })
  return { calls }
}

afterEach(() => {
  __resetClientForTests()
  useAttempt().setMock('l1-active')
})

describe('打开做题页：真实模式不拿演示数据顶替', () => {
  it('空状态形状完整，但没有任何题目内容', () => {
    const empty = createEmptyAttemptState()
    expect(empty.attemptId).toBe('')
    expect(empty.problem.stem).toBe('')
    expect(empty.layers).toEqual([])
    expect(empty.steps?.lines).toEqual([])
  })

  it('真实模式一开始就清空 store，并处在 loading', () => {
    realClient([() => jsonResponse({})])
    const session = useAttemptSession(stubDrafts())
    expect(session.phase.value).toBe('loading')
    expect(session.state.value.attemptId).toBe('')
    expect(session.state.value.problem.title).toBe('')
  })

  it('真实模式没有作答或布置 id：错误屏，不停在假数据上', async () => {
    realClient([() => jsonResponse({})])
    const session = useAttemptSession(stubDrafts())
    await session.load({})
    expect(session.phase.value).toBe('error')
    expect(session.loadError.value).toContain('没有找到')
    expect(session.state.value.attemptId).toBe('')
  })

  it('加载成功：进入 ready，并恢复本机草稿', async () => {
    const remote = createMockState('l3-active')
    realClient([() => jsonResponse({ state: remote })])
    const drafts = stubDrafts()
    const session = useAttemptSession(drafts)
    await session.load({ attemptId: remote.attemptId })
    expect(session.phase.value).toBe('ready')
    expect(session.state.value.attemptId).toBe(remote.attemptId)
    expect(drafts.restoreDrafts).toHaveBeenCalledTimes(1)
  })

  it('加载失败：错误屏带服务端文案，重试用同一份参数后恢复', async () => {
    const remote = createMockState('l1-active')
    const { calls } = realClient([
      () => jsonResponse({ error: { code: 'NOT_FOUND', message: '找不到这次作答' } }, 404),
      () => jsonResponse({ state: remote }),
    ])
    const session = useAttemptSession(stubDrafts())
    await session.load({ attemptId: remote.attemptId })
    expect(session.phase.value).toBe('error')
    expect(session.loadError.value).toBe('找不到这次作答')
    expect(session.error.value).toBeNull()
    expect(session.state.value.attemptId).toBe('')

    await session.retryLoad()
    expect(session.phase.value).toBe('ready')
    expect(session.state.value.attemptId).toBe(remote.attemptId)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toBe(calls[1])
  })

  it('跨页交接的作答（重做）不用再请求，直接 ready', async () => {
    const { calls } = realClient([() => jsonResponse({})])
    const redo = { ...createMockState('l1-active'), kind: 'redo' as const }
    setPendingAttempt(redo)
    const session = useAttemptSession(stubDrafts())
    await session.load({})
    expect(session.phase.value).toBe('ready')
    expect(session.state.value.kind).toBe('redo')
    expect(calls).toHaveLength(0)
  })

  it('mock 模式：照常按 ?mock= 渲染演示状态', async () => {
    configureClientForTests({ mock: true })
    const session = useAttemptSession(stubDrafts())
    expect(session.phase.value).toBe('ready')
    await session.load({ mock: 'l3-active' })
    expect(session.phase.value).toBe('ready')
    expect(session.state.value.currentLayer).toBe('L3')
  })
})
