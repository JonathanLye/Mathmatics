/**
 * 拍照识别：图片压缩（#25 / 03 §3.3、openapi /recognitions/photo）。
 *
 * 契约要求：JPEG/PNG，前端压到**长边 ≤ 2000px、≤ 2MB、去 EXIF**。
 * - 解码后重绘到 canvas 再编码为 JPEG：重编码即去掉 EXIF/GPS/设备信息；方向在解码时按 EXIF 摆正
 *   （createImageBitmap 的 imageOrientation: 'from-image'；老浏览器用 <img>，现代浏览器同样按 EXIF 摆正）；
 * - 先按质量阶梯尝试（默认 0.82 → 0.5），仍超 2MB 再逐轮缩小尺寸（默认 3 轮、每轮 0.7），最多 15 次编码；
 * - 纯规划函数（fitWithin / qualityPlan / buildCompressAttempts）与 H5 编解码分开，测试可注入 decode/encode，
 *   不需要真实 canvas/jsdom；
 * - 非 H5 环境（小程序/SSR）没有 DOM canvas → 抛 ImageCompressError('unsupported')，页面降级提示用键盘/手写。
 */

export const MAX_IMAGE_EDGE = 2000
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const DEFAULT_QUALITY_START = 0.82
export const DEFAULT_QUALITY_FLOOR = 0.5
export const DEFAULT_QUALITY_STEP = 0.08
export const DEFAULT_SHRINK_ROUNDS = 3
export const SHRINK_FACTOR = 0.7

export type ImageCompressErrorCode = 'unsupported' | 'empty' | 'invalid_type' | 'decode' | 'encode' | 'too_large'

export class ImageCompressError extends Error {
  readonly code: ImageCompressErrorCode

  constructor(code: ImageCompressErrorCode, message: string) {
    super(message)
    this.name = 'ImageCompressError'
    this.code = code
  }
}

export function isImageCompressError(error: unknown): error is ImageCompressError {
  return error instanceof ImageCompressError
}

export interface ImageSize {
  width: number
  height: number
}

export interface CompressOptions {
  /** 长边上限（默认 2000）。 */
  maxEdge?: number
  /** 字节上限（默认 2MB）。 */
  maxBytes?: number
  qualityStart?: number
  qualityFloor?: number
  qualityStep?: number
  /** 质量阶梯都超限后的缩小轮数（默认 3）。 */
  shrinkRounds?: number
}

export type NormalizedCompressOptions = Required<CompressOptions>

export interface CompressAttempt extends ImageSize {
  quality: number
  round: number
}

export interface CompressedImage {
  blob: Blob
  width: number
  height: number
  quality: number
  bytes: number
  type: 'image/jpeg'
  attempts: number
}

/** 解码结果：image 是可直接 drawImage 的源；close 释放 ImageBitmap/objectURL。 */
export interface DecodedImage {
  image: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

export interface CompressorDeps {
  decode: (source: Blob) => Promise<DecodedImage>
  encode: (image: CanvasImageSource, size: ImageSize, quality: number, type: 'image/jpeg') => Promise<Blob>
}

function positiveOr(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function clampQuality(value: unknown, fallback: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(1, Math.max(0.05, numeric))
}

/** 归一化压缩参数（非法值回退默认；maxBytes 上限仍受前端 2MB 约束保护，但允许测试注入更小值）。 */
export function normalizeCompressOptions(options: CompressOptions = {}): NormalizedCompressOptions {
  return {
    maxEdge: Math.round(positiveOr(options.maxEdge, MAX_IMAGE_EDGE)),
    maxBytes: Math.round(positiveOr(options.maxBytes, MAX_IMAGE_BYTES)),
    qualityStart: clampQuality(options.qualityStart, DEFAULT_QUALITY_START),
    qualityFloor: clampQuality(options.qualityFloor, DEFAULT_QUALITY_FLOOR),
    qualityStep: Math.min(0.5, positiveOr(options.qualityStep, DEFAULT_QUALITY_STEP)),
    shrinkRounds: Math.min(6, Math.max(0, Math.round(Number(options.shrinkRounds ?? DEFAULT_SHRINK_ROUNDS)))),
  }
}

/** 等比缩到长边 ≤ maxEdge（整数像素，至少 1×1；不放大）。 */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_IMAGE_EDGE): ImageSize {
  const safeWidth = Math.max(1, Math.round(Number(width) || 0))
  const safeHeight = Math.max(1, Math.round(Number(height) || 0))
  const edge = Math.max(1, Math.round(Number(maxEdge) || MAX_IMAGE_EDGE))
  const longest = Math.max(safeWidth, safeHeight)
  if (longest <= edge) return { width: safeWidth, height: safeHeight }
  const scale = edge / longest
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  }
}

/** 质量阶梯：从 start 递减到 floor（至少含 start 与 floor；不重复、单调不增）。 */
export function qualityPlan(options: CompressOptions = {}): number[] {
  const opts = normalizeCompressOptions(options)
  const start = Math.max(opts.qualityFloor, opts.qualityStart)
  const plan: number[] = []
  const push = (value: number): void => {
    const rounded = Math.round(value * 1000) / 1000
    if (rounded < 0.05 || rounded > 1) return
    if (plan.length === 0 || rounded < plan[plan.length - 1]!) plan.push(rounded)
  }
  for (let quality = start; quality >= opts.qualityFloor - 1e-9; quality -= opts.qualityStep) push(quality)
  push(opts.qualityFloor)
  return plan
}

/**
 * 生成压缩尝试序列：第 0 轮按原始尺寸 fitWithin，之后每轮尺寸 ×0.7。
 * 每轮先走完整质量阶梯，再缩尺寸；总编码次数有界（≤ (rounds+1)×plan.length）。
 */
export function buildCompressAttempts(source: ImageSize, options: CompressOptions = {}): CompressAttempt[] {
  const opts = normalizeCompressOptions(options)
  const plan = qualityPlan(opts)
  const attempts: CompressAttempt[] = []
  for (let round = 0; round <= opts.shrinkRounds; round += 1) {
    const scale = round === 0 ? 1 : SHRINK_FACTOR ** round
    const size = fitWithin(Math.max(1, source.width * scale), Math.max(1, source.height * scale), opts.maxEdge)
    for (const quality of plan) attempts.push({ ...size, quality, round })
  }
  return attempts
}

/** 判断当前环境是否具备 canvas 编码能力（H5 浏览器；非 H5/SSR 返回 false）。 */
export function canCompressImages(env: unknown = globalThis): boolean {
  const global = env as { document?: { createElement?: unknown }; Blob?: unknown; URL?: { createObjectURL?: unknown } } | null
  if (!global) return false
  if (typeof global.Blob !== 'function') return false
  const doc = global.document
  if (!doc || typeof doc.createElement !== 'function') return false
  try {
    const canvas = (doc.createElement as (tag: string) => { getContext?: unknown })('canvas')
    return typeof canvas?.getContext === 'function'
  } catch {
    return false
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const meta = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mimeMatch = /data:([^;]+)/.exec(meta)
  const mime = mimeMatch?.[1] ?? 'image/jpeg'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

function browserDecode(source: Blob): Promise<DecodedImage> {
  const global = globalThis as {
    createImageBitmap?: (blob: Blob, options?: { imageOrientation?: 'from-image' | 'flipY' | 'none' }) => Promise<ImageBitmap>
    Image?: new () => HTMLImageElement
    URL?: { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void }
  }
  if (typeof global.createImageBitmap === 'function') {
    return global
      .createImageBitmap(source, { imageOrientation: 'from-image' })
      .then((bitmap) => ({ image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }))
      .catch(() => legacyImageDecode(source))
  }
  return legacyImageDecode(source)
}

function legacyImageDecode(source: Blob): Promise<DecodedImage> {
  const global = globalThis as {
    Image?: new () => HTMLImageElement
    URL?: { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void }
  }
  const ImageCtor = global.Image
  const urlApi = global.URL
  if (!ImageCtor || typeof urlApi?.createObjectURL !== 'function') {
    return Promise.reject(new ImageCompressError('decode', '当前环境不能解码图片'))
  }
  const url = urlApi.createObjectURL(source)
  return new Promise<DecodedImage>((resolve, reject) => {
    const image = new ImageCtor()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        urlApi.revokeObjectURL?.(url)
        reject(new ImageCompressError('decode', '图片尺寸无效'))
        return
      }
      resolve({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => urlApi.revokeObjectURL?.(url),
      })
    }
    image.onerror = () => {
      urlApi.revokeObjectURL?.(url)
      reject(new ImageCompressError('decode', '图片解码失败'))
    }
    image.src = url
  })
}

function browserEncode(image: CanvasImageSource, size: ImageSize, quality: number, type: 'image/jpeg'): Promise<Blob> {
  const doc = (globalThis as { document?: Document }).document
  if (!doc || typeof doc.createElement !== 'function') {
    return Promise.reject(new ImageCompressError('encode', '当前环境不能编码图片'))
  }
  return new Promise<Blob>((resolve, reject) => {
    try {
      const canvas = doc.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new ImageCompressError('encode', '画布不可用'))
        return
      }
      // JPEG 无透明通道：先铺白底，避免 PNG 透明区域变黑。
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, size.width, size.height)
      context.drawImage(image, 0, 0, size.width, size.height)
      const done = (blob: Blob | null): void => {
        if (!blob || blob.size <= 0) {
          reject(new ImageCompressError('encode', '图片编码失败'))
          return
        }
        resolve(blob)
      }
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(done, type, quality)
        return
      }
      try {
        done(dataUrlToBlob(canvas.toDataURL(type, quality)))
      } catch {
        reject(new ImageCompressError('encode', '图片编码失败'))
      }
    } catch {
      reject(new ImageCompressError('encode', '图片编码失败'))
    }
  })
}

/**
 * 读取 chooseImage 返回的临时路径为 Blob（H5：data:/blob:/http(s)）。
 * 非 H5 的 wxfile:// 等路径无法在浏览器读取 → 抛 unsupported，由页面提示改用键盘。
 */
export async function loadImageBlobFromPath(path: string): Promise<Blob> {
  if (typeof path !== 'string' || path.length === 0) {
    throw new ImageCompressError('empty', '没有选择图片')
  }
  if (path.startsWith('wxfile://') || path.startsWith('file://')) {
    throw new ImageCompressError('unsupported', '当前环境不支持读取本机图片，请用键盘或手写')
  }
  try {
    const response = await fetch(path)
    if (!response.ok) throw new Error(String(response.status))
    const blob = await response.blob()
    if (blob.size <= 0) throw new ImageCompressError('empty', '图片内容为空')
    return blob
  } catch (error) {
    if (isImageCompressError(error)) throw error
    throw new ImageCompressError('decode', '读取图片失败，请重试')
  }
}

/** 校验 + 压缩：始终重编码为 JPEG（去 EXIF）；成功返回 ≤ maxBytes 的结果。 */
export async function compressImage(
  source: Blob,
  options: CompressOptions = {},
  deps?: Partial<CompressorDeps>,
): Promise<CompressedImage> {
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (source.size <= 0) throw new ImageCompressError('empty', '图片内容为空')
    if (source.type && !source.type.startsWith('image/')) {
      throw new ImageCompressError('invalid_type', '只支持图片文件')
    }
  } else {
    throw new ImageCompressError('empty', '没有选择图片')
  }
  const opts = normalizeCompressOptions(options)
  const canDefault = canCompressImages()
  const decode = deps?.decode ?? (canDefault ? browserDecode : null)
  const encode = deps?.encode ?? (canDefault ? browserEncode : null)
  if (!decode || !encode) {
    throw new ImageCompressError('unsupported', '当前环境不支持图片压缩，请用键盘或手写')
  }

  let decoded: DecodedImage
  try {
    decoded = await decode(source)
  } catch (error) {
    if (isImageCompressError(error)) throw error
    throw new ImageCompressError('decode', '图片解码失败，请重拍')
  }
  try {
    if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) {
      throw new ImageCompressError('decode', '图片尺寸无效')
    }
    const attempts = buildCompressAttempts({ width: decoded.width, height: decoded.height }, opts)
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index] as CompressAttempt
      let blob: Blob
      try {
        blob = await encode(decoded.image, { width: attempt.width, height: attempt.height }, attempt.quality, 'image/jpeg')
      } catch (error) {
        if (isImageCompressError(error)) throw error
        throw new ImageCompressError('encode', '图片压缩失败，请重拍或用键盘')
      }
      if (blob.size > 0 && blob.size <= opts.maxBytes) {
        return {
          blob,
          width: attempt.width,
          height: attempt.height,
          quality: attempt.quality,
          bytes: blob.size,
          type: 'image/jpeg',
          attempts: index + 1,
        }
      }
    }
    throw new ImageCompressError('too_large', '图片压缩后仍然太大，请靠近一点重拍或用键盘')
  } finally {
    try {
      decoded.close?.()
    } catch {
      /* 释放失败不影响结果 */
    }
  }
}
