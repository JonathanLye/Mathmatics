import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_QUALITY_START,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE,
  ImageCompressError,
  buildCompressAttempts,
  canCompressImages,
  compressImage,
  fitWithin,
  loadImageBlobFromPath,
  normalizeCompressOptions,
  qualityPlan,
} from '@/utils/imageCompress'

/** #25：拍照压缩的纯规划 + 注入 decode/encode 的流程测试（不依赖 DOM/canvas）。 */

function fakeBlob(bytes = 1024, type = 'image/png'): Blob {
  return new Blob([new Uint8Array(bytes)], { type })
}

function fakeDeps(encodedSizes: number[], decoded = { width: 3000, height: 1500 }) {
  const close = vi.fn()
  const encode = vi.fn(async () => fakeBlob(encodedSizes.shift() ?? 0, 'image/jpeg'))
  const decode = vi.fn(async () => ({ image: {} as CanvasImageSource, width: decoded.width, height: decoded.height, close }))
  return { decode, encode, close }
}

describe('imageCompress：尺寸/质量规划（纯函数）', () => {
  it('fitWithin：长边缩到 ≤2000，宽高比保持、不放大、整数像素', () => {
    expect(fitWithin(4000, 2000)).toEqual({ width: 2000, height: 1000 })
    expect(fitWithin(1000, 4000)).toEqual({ width: 500, height: 2000 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(3001, 10)).toEqual({ width: 2000, height: 7 })
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(2000, 2000, 2000)).toEqual({ width: 2000, height: 2000 })
  })

  it('normalizeCompressOptions：默认值与非法值回退', () => {
    const defaults = normalizeCompressOptions()
    expect(defaults.maxEdge).toBe(MAX_IMAGE_EDGE)
    expect(defaults.maxBytes).toBe(MAX_IMAGE_BYTES)
    expect(defaults.qualityStart).toBe(DEFAULT_QUALITY_START)
    expect(defaults.qualityFloor).toBe(0.5)
    const custom = normalizeCompressOptions({ maxEdge: 0, maxBytes: -1, qualityStart: 3, qualityFloor: 0.05, qualityStep: 0 })
    expect(custom.maxEdge).toBe(MAX_IMAGE_EDGE)
    expect(custom.maxBytes).toBe(MAX_IMAGE_BYTES)
    expect(custom.qualityStart).toBe(1)
    expect(custom.qualityFloor).toBe(0.05)
    expect(custom.qualityStep).toBeGreaterThan(0)
  })

  it('qualityPlan：从 start 递减到 floor（含两端、单调不增、无重复）', () => {
    const plan = qualityPlan()
    expect(plan[0]).toBe(DEFAULT_QUALITY_START)
    expect(plan[plan.length - 1]).toBe(0.5)
    for (let i = 1; i < plan.length; i += 1) expect(plan[i]!).toBeLessThan(plan[i - 1]!)
    expect(new Set(plan).size).toBe(plan.length)
    expect(qualityPlan({ qualityStart: 0.9, qualityFloor: 0.85, qualityStep: 0.2 })).toEqual([0.9, 0.85])
  })

  it('buildCompressAttempts：首轮长边 ≤2000，后续轮尺寸缩小，次数有界', () => {
    const attempts = buildCompressAttempts({ width: 2800, height: 1400 }, { shrinkRounds: 2 })
    expect(attempts.length).toBeGreaterThan(0)
    const firstRound = attempts.filter((attempt) => attempt.round === 0)
    expect(firstRound.every((attempt) => attempt.width <= MAX_IMAGE_EDGE)).toBe(true)
    expect(Math.max(...attempts.map((attempt) => attempt.width))).toBeLessThanOrEqual(MAX_IMAGE_EDGE)
    for (const attempt of attempts) {
      expect(attempt.quality).toBeGreaterThanOrEqual(0.5)
      expect(attempt.quality).toBeLessThanOrEqual(1)
      expect(attempt.width).toBeGreaterThan(0)
      expect(attempt.height).toBeGreaterThan(0)
    }
    const round1 = attempts.find((attempt) => attempt.round === 1)!
    const round0 = attempts.find((attempt) => attempt.round === 0)!
    expect(round1.width).toBeLessThan(round0.width)
  })
})

describe('imageCompress：压缩流程（注入 decode/encode）', () => {
  it('按质量阶梯尝试，返回首个 ≤2MB 的结果，并释放解码资源', async () => {
    const deps = fakeDeps([MAX_IMAGE_BYTES + 1, 900 * 1024])
    const result = await compressImage(fakeBlob(5 * 1024 * 1024), {}, deps)
    expect(result.bytes).toBe(900 * 1024)
    expect(result.type).toBe('image/jpeg')
    expect(result.attempts).toBe(2)
    expect(result.width).toBe(2000)
    expect(result.height).toBe(1000)
    expect(deps.encode).toHaveBeenCalledTimes(2)
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('质量阶梯都超限 → 继续缩小尺寸；最终仍超限抛 too_large', async () => {
    const deps = fakeDeps([MAX_IMAGE_BYTES + 1, MAX_IMAGE_BYTES + 1, MAX_IMAGE_BYTES + 1, MAX_IMAGE_BYTES + 1])
    await expect(compressImage(fakeBlob(1024), { shrinkRounds: 1 }, deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(deps.encode.mock.calls.length).toBeGreaterThan(2)
    expect(deps.close).toHaveBeenCalledTimes(1)
  })

  it('空图片/非图片/解码失败有明确错误码', async () => {
    await expect(compressImage(fakeBlob(0), {}, fakeDeps([1]))).rejects.toMatchObject({ code: 'empty' })
    await expect(compressImage(fakeBlob(10, 'text/plain'), {}, fakeDeps([1]))).rejects.toMatchObject({ code: 'invalid_type' })
    const decode = vi.fn(async () => {
      throw new Error('bad image')
    })
    await expect(compressImage(fakeBlob(10), {}, { decode, encode: vi.fn() })).rejects.toMatchObject({ code: 'decode' })
  })

  it('Node/非 H5 环境没有 canvas 且未注入依赖 → unsupported（页面降级用键盘）', async () => {
    expect(canCompressImages()).toBe(false)
    await expect(compressImage(fakeBlob(10))).rejects.toBeInstanceOf(ImageCompressError)
    await expect(compressImage(fakeBlob(10))).rejects.toMatchObject({ code: 'unsupported' })
  })
})

describe('imageCompress：临时路径读取', () => {
  it('data: URL 可以读成 Blob', async () => {
    const dataUrl = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64')
    const blob = await loadImageBlobFromPath(dataUrl)
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toBe('image/png')
  })

  it('空路径/本机私有路径有明确降级错误', async () => {
    await expect(loadImageBlobFromPath('')).rejects.toMatchObject({ code: 'empty' })
    await expect(loadImageBlobFromPath('wxfile://tmp_1.jpg')).rejects.toMatchObject({ code: 'unsupported' })
  })
})
