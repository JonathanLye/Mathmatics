/**
 * 存储抽象（02 §9 存储限制）：业务代码不直接用 localStorage / window.indexedDB，
 * 一律经过这里的 KeyValueStore；H5 用 IndexedDB，小程序/降级用 uni API，测试用内存实现。
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}
