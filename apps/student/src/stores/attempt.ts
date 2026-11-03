/**
 * 做题状态（单例，无 pinia 依赖；P0 只有一条作答）。
 * 只保存服务端下发的 state；所有变更都由 api/client.ts 的 mock/真实接口返回新 state。
 */
import { computed, ref } from 'vue'
import { createMockState, DEFAULT_MOCK, isMockKey, MOCK_LABELS, type MockKey } from '@/mocks/attemptStates'
import type { AttemptState } from '@/types/attempt'

const state = ref<AttemptState>(createMockState(DEFAULT_MOCK))
const mockKey = ref<MockKey>(DEFAULT_MOCK)
const busy = ref(false)
const error = ref<string | null>(null)

const canFinish = computed(() => Boolean(state.value.steps?.canFinish))

function setMock(key: MockKey) {
  // 非法键（如 ?mock=constructor 绕过旧校验）回退默认状态，保证 state 永远可渲染。
  const safe = isMockKey(key) ? key : DEFAULT_MOCK
  mockKey.value = safe
  state.value = createMockState(safe)
}

function apply(next: AttemptState) {
  state.value = next
}

async function run<T>(fn: () => Promise<T>): Promise<T | null> {
  busy.value = true
  error.value = null
  try {
    return await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    return null
  } finally {
    busy.value = false
  }
}

export function useAttempt() {
  return { state, mockKey, busy, error, canFinish, labels: MOCK_LABELS, setMock, apply, run }
}
