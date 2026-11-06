import { afterEach, describe, expect, it } from 'vitest'

import {
  ApiError,
  __resetClientForTests,
  configureClientForTests,
  confirmRecognition,
  isMockMode,
  photoRecognitionErrorMessage,
  recognizePhoto,
} from '@/api/client'
import { mockPhotoRecognition } from '@/mocks/attemptStates'
import { ImageCompressError } from '@/utils/imageCompress'

/** #25：拍照识别 API（multipart 字段 + confirm body + 错误降级文案）。 */

interface Call {
  url: string
  init: RequestInit
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function captureFetch(responder: (call: Call) => Response) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const call: Call = { url, init }
    calls.push(call)
    return responder(call)
  }
  return { calls, fetchImpl }
}

function headersOf(call: Call): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>
}

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const DRAFT = '22222222-2222-4222-8222-222222222222'
const RECOG = '33333333-3333-4333-8333-333333333333'

function imageBlob(): Blob {
  return new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })
}

afterEach(() => {
  __resetClientForTests()
})

describe('recognizePhoto：multipart 契约', () => {
  it('POST /recognitions/photo：FormData 字段齐全、不手设 Content-Type、带 X-Requested-With/credentials', async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ recogId: RECOG, status: 'ok', lines: [{ text: 'x' }] }))
    configureClientForTests({ fetchImpl, mock: false })

    const result = await recognizePhoto({
      attemptId: ATTEMPT,
      draftId: DRAFT,
      target: 'line_statement',
      source: 'camera',
      image: imageBlob(),
    })

    expect(result.recogId).toBe(RECOG)
    expect(calls).toHaveLength(1)
    const call = calls[0] as Call
    expect(call.url).toBe('/api/v1/recognitions/photo')
    expect(call.init.method).toBe('POST')
    expect(call.init.credentials).toBe('include')
    const headers = headersOf(call)
    expect(headers['X-Requested-With']).toBe('proof-gym')
    expect(headers['Content-Type']).toBeUndefined()
    const form = call.init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('attemptId')).toBe(ATTEMPT)
    expect(form.get('draftId')).toBe(DRAFT)
    expect(form.get('target')).toBe('line_statement')
    expect(form.get('source')).toBe('camera')
    const image = form.get('image') as File
    expect(image.name).toBe('photo.jpg')
    expect(image.type).toBe('image/jpeg')
    expect(image.size).toBe(3)
  })

  it('source 可为 album（从相册选择）', async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ recogId: RECOG, status: 'ok' }))
    configureClientForTests({ fetchImpl, mock: false })
    await recognizePhoto({ attemptId: ATTEMPT, draftId: DRAFT, target: 'line_statement', source: 'album', image: imageBlob() })
    const form = (calls[0] as Call).init.body as FormData
    expect(form.get('source')).toBe('album')
  })
})

describe('confirmRecognition：JSON body', () => {
  it('POST /recognitions/{id}/confirm：text + lines，recogId 编码', async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ recogId: RECOG, edited: true, rendered: true }))
    configureClientForTests({ fetchImpl, mock: false })
    const result = await confirmRecognition(RECOG, '第一行\n第二行', ['第一行', '第二行'])
    expect(result).toEqual({ recogId: RECOG, edited: true, rendered: true })
    const call = calls[0] as Call
    expect(call.url).toBe('/api/v1/recognitions/' + RECOG + '/confirm')
    expect(call.init.method).toBe('POST')
    expect(headersOf(call)['X-Requested-With']).toBe('proof-gym')
    expect(JSON.parse(String(call.init.body))).toEqual({ text: '第一行\n第二行', lines: ['第一行', '第二行'] })
  })

  it('无 lines 时不发 lines 字段', async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse({ recogId: RECOG, edited: false }))
    configureClientForTests({ fetchImpl, mock: false })
    await confirmRecognition(RECOG, '单行')
    expect(JSON.parse(String((calls[0] as Call).init.body))).toEqual({ text: '单行' })
  })
})

describe('mock 模式：拍照识别可演示（不伪造真实服务端）', () => {
  it('recognizePhoto 返回 3 行 mock；confirmRecognition 返回成功回执', async () => {
    configureClientForTests({ mock: true })
    expect(isMockMode()).toBe(true)
    const result = await recognizePhoto({ attemptId: ATTEMPT, draftId: DRAFT, target: 'line_statement', source: 'camera', image: imageBlob() })
    expect(result.lines?.length).toBe(3)
    expect(result.recogId).toBe(mockPhotoRecognition.recogId)
    const confirmed = await confirmRecognition(result.recogId, 'x', ['x'])
    expect(confirmed.rendered).toBe(true)
    expect(confirmed.edited).toBe(false)
  })
})

describe('photoRecognitionErrorMessage：真实服务端错误语义', () => {
  it('404/NOT_FOUND → 识别记录或作答不存在（不再误报“即将上线”）', () => {
    const copy = photoRecognitionErrorMessage(new ApiError({ status: 404, code: 'NOT_FOUND', message: '请求的内容不存在' }))
    expect(copy).toContain('不存在')
    expect(copy).toContain('键盘')
    expect(copy).not.toContain('即将上线')
  })

  it('PHOTO_DISABLED 展示服务端具体原因（未开放 / 老师关闭）', () => {
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 403, code: 'PHOTO_DISABLED', message: '拍照识别暂未开放，请用键盘或手写' })),
    ).toContain('暂未开放')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 403, code: 'PHOTO_DISABLED', message: '老师关闭了拍照识别，请用键盘或手写' })),
    ).toContain('老师关闭')
  })

  it('RATE_LIMITED 展示服务端具体原因（上一张 / 今日次数 / 每分钟）', () => {
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '上一张还在识别，请稍等' })),
    ).toContain('上一张')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '今天的拍照识别次数用完了，可以改用键盘输入' })),
    ).toContain('次数用完')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 429, code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试' })),
    ).toContain('操作太频繁')
  })

  it('413/NETWORK/TEST/UPSTREAM 仍有学生可读文案', () => {
    expect(photoRecognitionErrorMessage(new ApiError({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'x' }))).toContain('太大')
    expect(photoRecognitionErrorMessage(new ApiError({ status: 0, code: 'NETWORK', message: 'x' }))).toContain('网络')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 403, code: 'TEST_MODE_RESTRICTED', message: 'x' })),
    ).toContain('测验模式')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 503, code: 'UPSTREAM_UNAVAILABLE', message: 'x' })),
    ).toContain('识别服务暂时不可用')
  })

  it('403 同意/年龄、409 锁定/未确认、422 参数错误有明确提示', () => {
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 403, code: 'CONSENT_REQUIRED', message: 'x' })),
    ).toContain('知情同意书')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 409, code: 'AGE_BAND_REQUIRED', message: 'x' })),
    ).toContain('年龄段')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 403, code: 'AGE_RESTRICTED', message: 'x' })),
    ).toContain('14 岁')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 409, code: 'ATTEMPT_LOCKED', message: 'x' })),
    ).toContain('锁定')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 409, code: 'RECOG_NOT_CONFIRMED', message: 'x' })),
    ).toContain('确认')
    expect(
      photoRecognitionErrorMessage(new ApiError({ status: 422, code: 'VALIDATION_FAILED', message: 'x' })),
    ).toContain('重新拍照')
  })

  it('压缩失败有对应降级文案（unsupported/too_large）', () => {
    expect(photoRecognitionErrorMessage(new ImageCompressError('unsupported', 'x'))).toContain('键盘')
    expect(photoRecognitionErrorMessage(new ImageCompressError('too_large', 'x'))).toContain('太大')
  })
})
