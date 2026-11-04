/**
 * 存储适配器测试：
 * - IndexedDB 适配器用最小 fake IDBFactory（CI 的 node 环境没有 indexedDB）；
 * - resolveStorage 在无 indexedDB / uni 时退回内存实现。
 */
import { describe, expect, it } from 'vitest'
import { createIndexedDBStore, isIndexedDBSupported } from '@/storage/indexeddb'
import { createMemoryStore } from '@/storage/memory'
import { resolveStorage, setStorageForTests } from '@/storage'

function createFakeIDBFactory(): IDBFactory {
  type AnyHandler = ((event?: unknown) => void) | null
  const data = new Map<string, Map<string, unknown>>()
  const makeRequest = (result: unknown): unknown => {
    const request: Record<string, unknown> = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    }
    setTimeout(() => {
      request.result = result
      const handler = request.onsuccess as AnyHandler
      handler?.()
    }, 0)
    return request
  }
  const factory = {
    open(name: string) {
      if (!data.has(name)) data.set(name, new Map())
      const storeData = data.get(name) as Map<string, unknown>
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({}),
        transaction: () => {
          const tx: Record<string, unknown> = {
            objectStore: () => ({
              get: (key: string) => makeRequest(storeData.get(key)),
              put: (value: unknown, key: string) => {
                storeData.set(key, value)
                return makeRequest(key)
              },
              delete: (key: string) => {
                storeData.delete(key)
                return makeRequest(undefined)
              },
              getAllKeys: () => makeRequest(Array.from(storeData.keys())),
            }),
            oncomplete: null,
            onerror: null,
            onabort: null,
            error: null,
            abort() {},
          }
          setTimeout(() => {
            const handler = tx.oncomplete as AnyHandler
            handler?.()
          }, 5)
          return tx
        },
        close() {},
      }
      const request: Record<string, unknown> = {
        result: db,
        error: null,
        onsuccess: null,
        onupgradeneeded: null,
        onerror: null,
      }
      setTimeout(() => {
        const upgrade = request.onupgradeneeded as AnyHandler
        upgrade?.()
        const success = request.onsuccess as AnyHandler
        success?.()
      }, 0)
      return request
    },
  }
  return factory as unknown as IDBFactory
}

describe('#27 存储抽象（02 §9）', () => {
  it('内存实现 get/set/remove/keys', async () => {
    const store = createMemoryStore()
    expect(await store.get('a')).toBeNull()
    await store.set('a', { text: 'x' })
    expect(await store.get<{ text: string }>('a')).toEqual({ text: 'x' })
    expect(await store.keys()).toEqual(['a'])
    await store.remove('a')
    expect(await store.get('a')).toBeNull()
  })

  it('IndexedDB 适配器：set/get/keys/remove 往返（fake factory）', async () => {
    const store = createIndexedDBStore({ factory: createFakeIDBFactory() })
    await store.set('draft:1:def', { text: 'hello', updatedAt: '2026-11-04T00:00:00.000Z' })
    expect(await store.get('draft:1:def')).toEqual({ text: 'hello', updatedAt: '2026-11-04T00:00:00.000Z' })
    expect(await store.keys()).toEqual(['draft:1:def'])
    await store.remove('draft:1:def')
    expect(await store.get('draft:1:def')).toBeNull()
  })

  it('IndexedDB 不可用标记（node 无 indexedDB 时 isIndexedDBSupported=false，但注入 factory 为 true）', () => {
    expect(isIndexedDBSupported()).toBe(false)
    expect(isIndexedDBSupported(createFakeIDBFactory())).toBe(true)
  })

  it('resolveStorage：无 indexedDB/uni 时退回内存实现（仍是可用的 KeyValueStore）', async () => {
    setStorageForTests(null)
    const store = resolveStorage()
    await store.set('k', 1)
    expect(await store.get('k')).toBe(1)
    setStorageForTests(null)
  })

  it('setStorageForTests 可注入指定实现（做题页单例用）', async () => {
    const memory = createMemoryStore()
    setStorageForTests(memory)
    expect(resolveStorage()).toBe(memory)
    setStorageForTests(null)
  })
})
