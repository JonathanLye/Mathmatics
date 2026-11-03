import { createIndexedDBStore, isIndexedDBSupported } from './indexeddb'
import { createMemoryStore } from './memory'
import { createUniStore } from './uni'
import type { KeyValueStore } from './types'

let resolved: KeyValueStore | null = null

/**
 * 解析当前平台的持久化实现（02 §9）：
 * H5 → IndexedDB；小程序/降级 → uni API；都不可用 → 内存（草稿功能仍可用，刷新即丢）。
 * 单例会缓存，避免每个草稿都重新 open IndexedDB。
 */
export function resolveStorage(): KeyValueStore {
  if (resolved) return resolved
  if (isIndexedDBSupported()) resolved = createIndexedDBStore()
  else resolved = createUniStore() ?? createMemoryStore()
  return resolved
}

/** 单测/特殊场景注入自定义实现。 */
export function setStorageForTests(store: KeyValueStore | null): void {
  resolved = store
}
