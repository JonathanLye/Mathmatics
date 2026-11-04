import type { KeyValueStore } from './types'

type UniStorageApi = {
  getStorageSync?: (key: string) => unknown
  setStorageSync?: (key: string, value: unknown) => void
  removeStorageSync?: (key: string) => void
  getStorageInfoSync?: () => { keys?: string[] }
}

function getUniApi(): UniStorageApi | null {
  const api = (globalThis as { uni?: UniStorageApi }).uni
  return api && typeof api.getStorageSync === 'function' ? api : null
}

/**
 * uni API 实现（02 §9）：H5 下内部就是 localStorage，但业务代码不直接碰 localStorage，
 * 小程序端也能无缝走同一接口。不可用时返回 null。
 */
export function createUniStore(): KeyValueStore | null {
  const api = getUniApi()
  if (!api) return null
  const rawGet = api.getStorageSync as (key: string) => unknown
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const value = rawGet(key)
        return value === '' || value === undefined || value === null ? null : (value as T)
      } catch {
        return null
      }
    },
    async set<T>(key: string, value: T): Promise<void> {
      try {
        api.setStorageSync?.(key, value)
      } catch {
        /* 存储已满/隐私模式：草稿功能降级为内存，不抛给 UI */
      }
    },
    async remove(key: string): Promise<void> {
      try {
        api.removeStorageSync?.(key)
      } catch {
        /* ignore */
      }
    },
    async keys(): Promise<string[]> {
      try {
        return api.getStorageInfoSync?.()?.keys ?? []
      } catch {
        return []
      }
    },
  }
}

/** 同步读设备 ID 用（初始化时只需要一个键；02 §9 允许 uni API）。 */
export function readUniStorage<T>(key: string): T | null {
  const api = getUniApi()
  if (!api) return null
  try {
    const value = api.getStorageSync?.(key)
    return value === '' || value === undefined || value === null ? null : (value as T)
  } catch {
    return null
  }
}

export function writeUniStorage(key: string, value: unknown): void {
  const api = getUniApi()
  if (!api) return
  try {
    api.setStorageSync?.(key, value)
  } catch {
    /* ignore */
  }
}
