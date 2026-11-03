import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '@/storage/memory'
import { DraftStore, draftKey } from '@/storage/drafts'

const ATTEMPT = '11111111-1111-4111-8111-111111111111'

describe('#27 IndexedDB 草稿（防抖 / 恢复 / 提交清除）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('saveDraft 防抖：防抖窗口内多次输入只落最后一次', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store, { debounceMs: 500 })
    drafts.saveDraft(ATTEMPT, 'def', '第一版')
    drafts.saveDraft(ATTEMPT, 'def', '第二版')
    await vi.advanceTimersByTimeAsync(300)
    expect(await store.get(draftKey(ATTEMPT, 'def'))).toBeNull()
    await vi.advanceTimersByTimeAsync(200)
    expect(await store.get<{ text: string }>(draftKey(ATTEMPT, 'def'))).toMatchObject({ text: '第二版' })
  })

  it('loadDraft 恢复文本；缺省返回 null；空文本不恢复', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store)
    expect(await drafts.loadDraft(ATTEMPT, 'def')).toBeNull()
    await drafts.saveDraftNow(ATTEMPT, 'def', '写出定义')
    expect(await drafts.loadDraft(ATTEMPT, 'def')).toBe('写出定义')
    await drafts.saveDraftNow(ATTEMPT, 'def', '')
    expect(await drafts.loadDraft(ATTEMPT, 'def')).toBeNull()
  })

  it('记录带 updatedAt（ISO），且只存 text（无 token/PII）', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store, { now: () => Date.parse('2026-11-04T00:00:00.000Z') })
    await drafts.saveDraftNow(ATTEMPT, 'def', 'abc')
    const record = await store.get<Record<string, unknown>>(draftKey(ATTEMPT, 'def'))
    expect(Object.keys(record ?? {}).sort()).toEqual(['text', 'updatedAt'])
    expect(record?.updatedAt).toBe('2026-11-04T00:00:00.000Z')
  })

  it('clearDraft 取消挂起的防抖写入（提交成功后不再恢复）', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store, { debounceMs: 500 })
    drafts.saveDraft(ATTEMPT, 'def', '未提交')
    await drafts.clearDraft(ATTEMPT, 'def')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await store.get(draftKey(ATTEMPT, 'def'))).toBeNull()
  })

  it('flush 立即落盘挂起草稿（页面隐藏/卸载前）', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store, { debounceMs: 500 })
    drafts.saveDraft(ATTEMPT, 'line_statement', '结论')
    drafts.flush()
    await Promise.resolve()
    expect(await store.get<{ text: string }>(draftKey(ATTEMPT, 'line_statement'))).toMatchObject({ text: '结论' })
  })

  it('L3 结论/依据分开存，clearAttempt 全部清除', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store)
    await drafts.saveDraftNow(ATTEMPT, 'line_statement', '结论')
    await drafts.saveDraftNow(ATTEMPT, 'line_justification', '依据')
    expect(await drafts.loadDraft(ATTEMPT, 'line_statement')).toBe('结论')
    expect(await drafts.loadDraft(ATTEMPT, 'line_justification')).toBe('依据')
    await drafts.clearAttempt(ATTEMPT)
    expect(await drafts.loadDraft(ATTEMPT, 'line_statement')).toBeNull()
    expect(await drafts.loadDraft(ATTEMPT, 'line_justification')).toBeNull()
  })

  it('只按 attemptId 隔离：不同 attempt 的草稿互不影响', async () => {
    const store = createMemoryStore()
    const drafts = new DraftStore(store)
    await drafts.saveDraftNow(ATTEMPT, 'def', 'A 的草稿')
    await drafts.saveDraftNow('22222222-2222-4222-8222-222222222222', 'def', 'B 的草稿')
    expect(await drafts.loadDraft(ATTEMPT, 'def')).toBe('A 的草稿')
    expect(await drafts.loadDraft('22222222-2222-4222-8222-222222222222', 'def')).toBe('B 的草稿')
  })
})
