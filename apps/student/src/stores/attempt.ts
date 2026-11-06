/**
 * 做题状态（单例，无 pinia 依赖；P0 只有一条作答）。
 * 只保存服务端下发的 state；所有变更都由 api/client.ts 的 mock/真实接口返回新 state。
 * 真实模式从空状态开始（attemptId 为空），页面显示加载骨架，绝不拿演示数据顶替。
 */
import { computed, ref } from 'vue'
import { isMockMode } from '@/api/client'
import { createMockState, DEFAULT_MOCK, isMockKey, MOCK_LABELS, type MockKey } from '@/mocks/attemptStates'
import type { AttemptState } from '@/types/attempt'

/** 还没有拿到服务端 state 时的空状态：形状完整（页面可以安全读字段），但没有任何内容。 */
export function createEmptyAttemptState(): AttemptState {
  return {
    attemptId: '',
    stateVersion: 0,
    kind: 'main',
    status: 'active',
    mode: 'practice',
    problem: { problemId: '', version: 0, title: '', stem: '', chapter: '', keyCount: 0 },
    currentLayer: 'L1',
    layers: [],
    budget: { revealUsed: 0, revealMax: 0, keysOwn: 0, keysTotal: 0 },
    steps: { lines: [], canFinish: false },
    notes: [],
    help: { hintAvailable: false, exhausted: false, flagged: false },
    integrity: { mode: 'practice', locked: false },
    serverTime: '',
  }
}

const state = ref<AttemptState>(isMockMode() ? createMockState(DEFAULT_MOCK) : createEmptyAttemptState())
const mockKey = ref<MockKey>(DEFAULT_MOCK)
const busy = ref(false)
const error = ref<string | null>(null)

const canFinish = computed(() => Boolean(state.value.steps?.canFinish))

/**
 * 跨页交接的「下一份作答」：证明本「稍后重做」用 MockSwitcher 之外的方式发起新作答，
 * 在跳转做题页前把服务端返回的 state 暂存到这里，由做题页 onLoad 取走（仅 mock 阶段需要）。 */
let pendingAttempt: AttemptState | null = null

export function setPendingAttempt(next: AttemptState): void {
  pendingAttempt = next
}

export function takePendingAttempt(): AttemptState | null {
  const next = pendingAttempt
  pendingAttempt = null
  return next
}

function setMock(key: MockKey) {
  // 非法键（如 ?mock=constructor 绕过旧校验）回退默认状态，保证 state 永远可渲染。
  const safe = isMockKey(key) ? key : DEFAULT_MOCK
  mockKey.value = safe
  state.value = createMockState(safe)
}

function apply(next: AttemptState) {
  state.value = next
}

/** 清空到无内容状态（真实模式打开做题页时：上一次的作答不能留在屏幕上）。 */
function clear() {
  state.value = createEmptyAttemptState()
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
  return { state, mockKey, busy, error, canFinish, labels: MOCK_LABELS, setMock, apply, clear, run }
}
