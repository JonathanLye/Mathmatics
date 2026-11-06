/**
 * 识别失败时学生看到什么。服务商欠费、超时、断网都是常态：只说一句人话，给出口，绝不露原始报错。
 * 学生自己能解决的情况（照片太大、太频繁）才说具体原因，文案来自 photoRecognitionErrorMessage。
 */
import { photoRecognitionErrorMessage } from '@/api/client'
import { isApiError } from '@/api/http'
import { ImageCompressError } from '@/utils/imageCompress'

export interface RecognitionFailure {
  title: string
  body: string
}

/** 这些错误学生自己能处理，文案是写好的。其余一律当作「暂时用不了」。 */
const STUDENT_FIXABLE = new Set([
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'CONSENT_REQUIRED',
  'AGE_BAND_REQUIRED',
  'AGE_RESTRICTED',
  'FORBIDDEN',
  'TEST_MODE_RESTRICTED',
  'ATTEMPT_LOCKED',
])

export const PHOTO_UNAVAILABLE: RecognitionFailure = {
  title: '拍照识别暂时用不了',
  body: '你写的内容都还在。可以先用手写或键盘接着写，过一会儿也可以再试试拍照。',
}

/** 识别请求本身没拿到结果：网络、超时、服务商出问题，或者照片处理失败。 */
export function photoFailureOf(error: unknown): RecognitionFailure {
  if (error instanceof ImageCompressError) return { title: '这张照片用不了', body: photoRecognitionErrorMessage(error) }
  if (isApiError(error) && error.status < 500 && STUDENT_FIXABLE.has(error.code)) {
    return { title: '这次没能识别', body: photoRecognitionErrorMessage(error) }
  }
  return PHOTO_UNAVAILABLE
}

/** 请求成功了，但没有可用的行：status=error 同样算暂时用不了；什么都没认出来就请学生换个拍法。 */
export function photoFailureOfResult(result: { status?: string; text?: string | null; lines?: unknown[] | null }): RecognitionFailure | null {
  if (result.status === 'error') return PHOTO_UNAVAILABLE
  const hasLines = (result.lines?.length ?? 0) > 0 || Boolean(result.text)
  if (result.status === 'empty' || !hasLines) {
    return { title: '这张照片里没认出文字', body: '可以靠近一点再拍一张，或者用手写、键盘接着写。你写的内容都还在。' }
  }
  return null
}

/** 超时不等服务端：学生不该对着转圈等半分钟。 */
export const RECOGNITION_TIMEOUT_MS = 25000

export class RecognitionTimeoutError extends Error {
  constructor() {
    super('recognition timed out')
    this.name = 'RecognitionTimeoutError'
  }
}

export function withRecognitionTimeout<T>(request: Promise<T>, ms = RECOGNITION_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RecognitionTimeoutError()), ms)
    request.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
