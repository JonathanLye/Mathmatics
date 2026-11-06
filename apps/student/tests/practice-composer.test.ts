import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureClientForTests, __resetClientForTests } from '@/api/client'
import type { FetchLike } from '@/api/http'
import {
  PHOTO_UNAVAILABLE,
  RECOGNITION_TIMEOUT_MS,
  RecognitionTimeoutError,
  photoFailureOf,
  photoFailureOfResult,
  withRecognitionTimeout,
} from '@/components/practice/recognitionFailure'
import { justificationCandidates, keyLineOfTransition } from '@/components/practice/proofRail'
import { useAttemptSession } from '@/composables/practice/useAttemptSession'
import { useComposer } from '@/composables/practice/useComposer'
import { useDrafts } from '@/composables/practice/useDrafts'
import { createMockState } from '@/mocks/attemptStates'
import { useAttempt } from '@/stores/attempt'
import type { AttemptState, ProofLine } from '@/types/attempt'

vi.stubGlobal('uni', {
  getStorageSync: () => '',
  setStorageSync: () => undefined,
  showToast: () => undefined,
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** 真实模式下的输入器：作答在 L3，识别接口由测试决定怎么失败。 */
function composerWith(photo: FetchLike) {
  configureClientForTests({
    mock: false,
    fetchImpl: (url, init) => (String(url).includes('/recognitions/photo') ? photo(url, init) : Promise.resolve(jsonResponse({ error: { code: 'NOT_FOUND', message: 'no route' } }, 404))),
  })
  const drafts = useDrafts()
  const session = useAttemptSession(drafts)
  session.apply(createMockState('l3-active'))
  return useComposer(session, drafts)
}

const PHOTO = new Blob(['photo'], { type: 'image/jpeg' })

afterEach(() => {
  vi.useRealTimers()
  __resetClientForTests()
  useAttempt().setMock('l1-active')
})

describe('拍照识别失败：说人话、给出口、不丢内容', () => {
  it('服务商不可用（503，比如欠费）：显示暂时用不了，没有原始报错，写的内容还在', async () => {
    const composer = composerWith(async () => jsonResponse({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'dashscope: Arrearage 400 access denied' } }, 503))
    composer.openComposer()
    composer.statement.value = '$|a_n-3|<\\varepsilon$'
    composer.justification.value = '由第 1 行'
    composer.chooseTab('photo')

    await composer.recognizePhotoBlob(PHOTO, 'camera')

    expect(composer.photoFailure.value).toEqual(PHOTO_UNAVAILABLE)
    expect(composer.photoFailure.value?.title).toBe('拍照识别暂时用不了')
    expect(JSON.stringify(composer.photoFailure.value)).not.toMatch(/dashscope|Arrearage|503/)
    expect(composer.recogBusy.value).toBe(false)
    expect(composer.recognition.value).toBeNull()
    expect(composer.statement.value).toBe('$|a_n-3|<\\varepsilon$')
    expect(composer.justification.value).toBe('由第 1 行')
    expect(composer.editorOpen.value).toBe(true)
  }, 20000)

  it('一键切到手写或键盘，内容跟着走；拍照这一格还在，服务恢复后再试就能用', async () => {
    let healthy = false
    const composer = composerWith(async () =>
      healthy
        ? jsonResponse({ recogId: 'r1', status: 'ok', text: '$x$', lines: [{ text: '$x$' }] })
        : jsonResponse({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'down' } }, 503),
    )
    composer.openComposer()
    composer.statement.value = '已经写的一行'
    composer.chooseTab('photo')
    await composer.recognizePhotoBlob(PHOTO, 'camera')
    expect(composer.photoFailure.value).not.toBeNull()

    composer.chooseTab('keyboard')
    expect(composer.tab.value).toBe('keyboard')
    expect(composer.statement.value).toBe('已经写的一行')
    composer.chooseTab('hand')
    expect(composer.tab.value).toBe('hand')
    expect(composer.statement.value).toBe('已经写的一行')

    composer.chooseTab('photo')
    healthy = true
    await composer.recognizePhotoBlob(PHOTO, 'camera')
    expect(composer.photoFailure.value).toBeNull()
    expect(composer.recognition.value?.recogId).toBe('r1')
    expect(composer.photoConfirming.value).toBe(true)
  }, 20000)

  it('超时：不让学生一直等，同样是暂时用不了', async () => {
    vi.useFakeTimers()
    const composer = composerWith(() => new Promise<Response>(() => undefined))
    composer.openComposer()
    composer.statement.value = '留着'
    composer.chooseTab('photo')
    const pending = composer.recognizePhotoBlob(PHOTO, 'camera')
    expect(composer.recogBusy.value).toBe(true)
    await vi.advanceTimersByTimeAsync(RECOGNITION_TIMEOUT_MS + 1)
    await pending
    expect(composer.photoFailure.value).toEqual(PHOTO_UNAVAILABLE)
    expect(composer.recogBusy.value).toBe(false)
    expect(composer.statement.value).toBe('留着')
  })

  it('取消后迟到的失败不再弹出来', async () => {
    let fail: (response: Response) => void = () => undefined
    const composer = composerWith(() => new Promise<Response>((resolve) => { fail = resolve }))
    composer.openComposer()
    composer.chooseTab('photo')
    const pending = composer.recognizePhotoBlob(PHOTO, 'camera')
    composer.cancelRecognition()
    fail(jsonResponse({ error: { code: 'BAD_REQUEST', message: 'late' } }, 400))
    await pending
    expect(composer.photoFailure.value).toBeNull()
  })
})

describe('识别失败的说法', () => {
  it('不认识的错误一律是暂时用不了，原文不外露', () => {
    expect(photoFailureOf(new Error('TypeError: fetch failed at dashscope.aliyuncs.com'))).toEqual(PHOTO_UNAVAILABLE)
    expect(photoFailureOf(new RecognitionTimeoutError())).toEqual(PHOTO_UNAVAILABLE)
    expect(photoFailureOf(null)).toEqual(PHOTO_UNAVAILABLE)
  })

  it('接口成功但 status=error：同样暂时用不了；什么都没认出来：请学生换个拍法', () => {
    expect(photoFailureOfResult({ status: 'error' })).toEqual(PHOTO_UNAVAILABLE)
    expect(photoFailureOfResult({ status: 'empty' })?.title).toContain('没认出')
    expect(photoFailureOfResult({ status: 'ok', text: '', lines: [] })?.title).toContain('没认出')
    expect(photoFailureOfResult({ status: 'ok', text: '$x$', lines: [{ text: '$x$' }] })).toBeNull()
  })

  it('超时计时器：请求先回来就不算超时', async () => {
    await expect(withRecognitionTimeout(Promise.resolve('ok'), 5)).resolves.toBe('ok')
    await expect(withRecognitionTimeout(new Promise(() => undefined), 1)).rejects.toBeInstanceOf(RecognitionTimeoutError)
  })
})

describe('证明轨道的纯逻辑', () => {
  const line = (lineId: string, n: number, justification = ''): ProofLine => ({ lineId, n, statement: 's' + n, justification })
  function withKeys(state: AttemptState, keysOwn: number, lines: ProofLine[]): AttemptState {
    return { ...state, stateVersion: state.stateVersion + 1, budget: { ...state.budget, keysOwn }, steps: { lines, canFinish: false } }
  }

  it('关键步骤多了一个：算到新写的那一行', () => {
    const prev = withKeys(createMockState('l3-active'), 1, [line('a', 1)])
    expect(keyLineOfTransition(prev, withKeys(prev, 2, [line('a', 1), line('b', 2)]))).toBe('b')
  })

  it('关键步骤没变：不染色；测验模式：不染色', () => {
    const prev = withKeys(createMockState('l3-active'), 1, [line('a', 1)])
    expect(keyLineOfTransition(prev, withKeys(prev, 1, [line('a', 1), line('b', 2)]))).toBeNull()
    const test = { ...prev, mode: 'test' as const }
    expect(keyLineOfTransition(test, withKeys(test, 2, [line('a', 1), line('b', 2)]))).toBeNull()
  })

  it('改写一行后关键步骤多了：算到改的那一行', () => {
    const prev = withKeys(createMockState('l3-active'), 1, [line('a', 1)])
    const next = withKeys(prev, 2, [{ ...line('a', 1), statement: '改过了' }])
    expect(keyLineOfTransition(prev, next)).toBe('a')
  })

  it('依据候选：由上一行 + 用过的依据，去重，有上限', () => {
    expect(justificationCandidates([])).toEqual([])
    const lines = [line('a', 1, '通分'), line('b', 3, '放大'), line('c', 4, '通分')]
    expect(justificationCandidates(lines)).toEqual(['由第 4 行', '通分', '放大'])
    expect(justificationCandidates([line('a', 1, 'p'), line('b', 2, 'q'), line('c', 3, 'r'), line('d', 4, 's')], 2)).toEqual(['由第 4 行', 's'])
  })
})
