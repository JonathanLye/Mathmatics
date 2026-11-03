/**
 * IndexedDB 草稿（#27）：做题页输入防抖保存、重新打开提示恢复、提交成功后清除。
 *
 * 只存当前用户当前 attempt 的「必要字段」：
 *   { text, updatedAt }  —— 不存 token、不存匿名码/姓名等 PII。
 * 键：draft:<attemptId>:<target>
 *   target = def（L1 定义）| line_statement / line_justification（L3 每行）
 */
import { resolveStorage } from './index'
import type { KeyValueStore } from './types'

export type DraftTarget = 'def' | 'line_statement' | 'line_justification'
export const DRAFT_TARGETS: DraftTarget[] = ['def', 'line_statement', 'line_justification']

export interface DraftRecord {
  text: string
  updatedAt: string
}

export interface DraftStoreOptions {
  debounceMs?: number
  now?: () => number
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl?: (id: unknown) => void
}

export function draftKey(attemptId: string, target: DraftTarget): string {
  return 'draft:' + attemptId + ':' + target
}

/** 草稿存储：写走防抖，读/清立即；空文本等价于清除（避免恢复空气泡）。 */
export class DraftStore {
  private readonly store: KeyValueStore
  private readonly debounceMs: number
  private readonly now: () => number
  private readonly setTimeoutImpl: (fn: () => void, ms: number) => unknown
  private readonly clearTimeoutImpl: (id: unknown) => void
  private readonly timers = new Map<string, unknown>()
  private readonly pending = new Map<string, string>()

  constructor(store: KeyValueStore, options: DraftStoreOptions = {}) {
    this.store = store
    this.debounceMs = options.debounceMs ?? 500
    this.now = options.now ?? Date.now
    this.setTimeoutImpl = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>))
  }

  /** 防抖保存：同一 key 只保留最后一次（卸载前用 flush() 落盘）。 */
  saveDraft(attemptId: string, target: DraftTarget, text: string): void {
    const key = draftKey(attemptId, target)
    this.pending.set(key, text)
    const existing = this.timers.get(key)
    if (existing !== undefined) this.clearTimeoutImpl(existing)
    this.timers.set(
      key,
      this.setTimeoutImpl(() => {
        this.timers.delete(key)
        const next = this.pending.get(key) ?? ''
        this.pending.delete(key)
        void this.write(key, next)
      }, this.debounceMs),
    )
  }

  async saveDraftNow(attemptId: string, target: DraftTarget, text: string): Promise<void> {
    const key = draftKey(attemptId, target)
    this.pending.delete(key)
    const existing = this.timers.get(key)
    if (existing !== undefined) {
      this.clearTimeoutImpl(existing)
      this.timers.delete(key)
    }
    await this.write(key, text)
  }

  async loadDraft(attemptId: string, target: DraftTarget): Promise<string | null> {
    const key = draftKey(attemptId, target)
    const record = await this.store.get<DraftRecord>(key)
    if (!record || typeof record.text !== 'string' || record.text.length === 0) return null
    return record.text
  }

  async clearDraft(attemptId: string, target: DraftTarget): Promise<void> {
    const key = draftKey(attemptId, target)
    this.pending.delete(key)
    const timer = this.timers.get(key)
    if (timer !== undefined) {
      this.clearTimeoutImpl(timer)
      this.timers.delete(key)
    }
    await this.store.remove(key)
  }

  /** 清除某个 attempt 的全部草稿（完成/放弃时用）。 */
  async clearAttempt(attemptId: string): Promise<void> {
    await Promise.all(DRAFT_TARGETS.map((target) => this.clearDraft(attemptId, target)))
  }

  /** 把防抖中的草稿立即落盘（pagehide/卸载前调用；不保证异步完成）。 */
  flush(): void {
    for (const [key, text] of Array.from(this.pending.entries())) {
      this.pending.delete(key)
      const timer = this.timers.get(key)
      if (timer !== undefined) {
        this.clearTimeoutImpl(timer)
        this.timers.delete(key)
      }
      void this.write(key, text)
    }
  }

  private async write(key: string, text: string): Promise<void> {
    try {
      if (text.length === 0) {
        await this.store.remove(key)
        return
      }
      const record: DraftRecord = { text, updatedAt: new Date(this.now()).toISOString() }
      await this.store.set(key, record)
    } catch {
      /* 存储失败（配额/隐私模式）不影响作答，静默降级 */
    }
  }
}

let defaultDraftStore: DraftStore | null = null

/** 做题页用的单例（H5 IndexedDB / 降级 uni / 内存）。resolveStorage 内部有平台判断，不直接碰 window。 */
export function getDraftStore(): DraftStore {
  if (!defaultDraftStore) defaultDraftStore = new DraftStore(resolveStorage())
  return defaultDraftStore
}

