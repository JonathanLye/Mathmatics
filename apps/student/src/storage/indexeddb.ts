import type { KeyValueStore } from './types'

/** 浏览器是否支持 IndexedDB（H5 才有；隐私模式下 open 可能失败，由调用方兜底）。 */
export function isIndexedDBSupported(factory?: IDBFactory | null): boolean {
  if (factory) return true
  return typeof indexedDB !== 'undefined'
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb request failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb transaction aborted'))
  })
}

/**
 * H5 IndexedDB 实现（02 §9：草稿/待补发事件存本机）。
 * 只存 JSON 可序列化值；factory 可注入（单测用 fake-indexeddb 或手写 fake）。
 */
export function createIndexedDBStore(
  options: { dbName?: string; storeName?: string; factory?: IDBFactory } = {},
): KeyValueStore {
  const dbName = options.dbName ?? 'proof-gym'
  const storeName = options.storeName ?? 'kv'
  let dbPromise: Promise<IDBDatabase> | null = null

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    const factory = options.factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined)
    if (!factory) return Promise.reject(new Error('indexedDB unavailable'))
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
      request.onblocked = () => reject(new Error('indexedDB blocked'))
    })
    return dbPromise
  }

  async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await openDb()
    const tx = db.transaction(storeName, mode)
    try {
      const result = await fn(tx.objectStore(storeName))
      await txDone(tx)
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* ignore */
      }
      throw error
    }
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      const value = await withStore('readonly', (store) => requestToPromise<T | undefined>(store.get(key)))
      return value === undefined ? null : value
    },
    async set<T>(key: string, value: T): Promise<void> {
      await withStore('readwrite', async (store) => {
        await requestToPromise(store.put(value, key))
      })
    },
    async remove(key: string): Promise<void> {
      await withStore('readwrite', async (store) => {
        await requestToPromise(store.delete(key))
      })
    },
    async keys(): Promise<string[]> {
      const keys = await withStore('readonly', (store) => requestToPromise<IDBValidKey[]>(store.getAllKeys()))
      return keys.map((key) => String(key))
    },
  }
}
