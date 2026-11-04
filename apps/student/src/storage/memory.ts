import type { KeyValueStore } from './types'

/** 内存实现：测试 / 隐私模式 / 所有持久化都不可用时的兜底（刷新即丢，不会报错）。 */
export function createMemoryStore(): KeyValueStore {
  const data = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> {
      return data.has(key) ? (data.get(key) as T) : null
    },
    async set<T>(key: string, value: T): Promise<void> {
      data.set(key, value)
    },
    async remove(key: string): Promise<void> {
      data.delete(key)
    },
    async keys(): Promise<string[]> {
      return Array.from(data.keys())
    },
  }
}
