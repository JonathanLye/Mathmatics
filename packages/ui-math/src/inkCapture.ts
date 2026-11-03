/**
 * ink-v1 上传编码（03 §2.1「上传」）：
 * - openapi /recognitions/ink 的 ink 字段要求 gzip(JSON) 后 base64，单行上限 256 KB；
 * - H5 优先用 CompressionStream，不支持时（Safari < 16.4 等）用 pako 兜底；
 * - 超限时按 03 §2.1 逐级按 1 / 2 / 4 / 8 px 距离抽稀点后重试。
 *
 * 纯函数 + 标准 Web API / 动态加载 pako，不依赖 DOM（可在 node 环境测试）。
 * 原始 JSON 仍由 serializeInk 提供（组件通过 update:modelValue 暴露），本模块只负责上传编码。
 */
import {
  parseInk,
  serializeInk,
  simplifyPoints,
  type InkDocument,
  type InkEditState,
} from './ink'

/** openapi /recognitions/ink：单行上限 256 KB（按 base64 字符串长度保守判断）。 */
export const MAX_INK_CAPTURE_BYTES = 256 * 1024

export interface InkCapture {
  /** 参与上传的 ink-v1 JSON（若超限则是抽稀后的版本）。 */
  rawJson: string
  /** gzip(rawJson) 的 base64，直接作为 openapi 的 ink 字段。 */
  base64: string
  /** 原始 JSON 的 UTF-8 字节数。 */
  rawBytes: number
  /** gzip 压缩后的字节数（base64 解码后）。 */
  compressedBytes: number
  /** 是否因为超过上限而抽稀过点。 */
  simplified: boolean
  /** 抽稀后仍超过上限（服务端可能 413，需要调用方提示）。 */
  overLimit: boolean
}

export interface GzipOptions {
  /** 测试用：强制走 pako 兜底路径。 */
  forcePako?: boolean
}

export interface BuildInkCaptureOptions extends GzipOptions {
  /** 测试用：覆盖上限（默认 256 KB）。 */
  maxBytes?: number
}

/** gzip 后转 base64（CompressionStream 优先，pako 兜底）。 */
export async function gzipBase64(text: string, options: GzipOptions = {}): Promise<string> {
  const bytes = await gzipBytes(text, options)
  return bytesToBase64(bytes)
}

async function gzipBytes(text: string, options: GzipOptions): Promise<Uint8Array> {
  if (!options.forcePako && typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined') {
    return gzipWithCompressionStream(text)
  }
  return gzipWithPako(text)
}

async function gzipWithCompressionStream(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

async function gzipWithPako(text: string): Promise<Uint8Array> {
  const pako = await import('pako')
  return pako.gzip(text)
}

/** 不依赖 btoa/Buffer 的 base64 编码（H5 与 node 测试环境一致）。 */
function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8)
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + '='
  }
  return out
}

/** base64 字符串解码后的字节数（用于日志/上报，不真正解码）。 */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  // 极端兜底：逐字符估算（正常环境不会走到）
  let bytes = 0
  for (const char of text) bytes += char.codePointAt(0) !== undefined && char.codePointAt(0)! > 0x7ff ? 3 : 1
  return bytes
}

/**
 * 生成可直接上传的 ink-v1 捕获数据：
 * serializeInk → gzip → base64；超过 maxBytes 时按 03 §2.1 抽稀点后重试。
 */
export async function buildInkCapture(
  input: InkDocument | InkEditState | string,
  options: BuildInkCaptureOptions = {},
): Promise<InkCapture> {
  const maxBytes = options.maxBytes ?? MAX_INK_CAPTURE_BYTES
  let doc: InkDocument
  let rawJson: string
  if (typeof input === 'string') {
    doc = parseInk(input)
    rawJson = serializeInk(doc)
  } else if ('doc' in input) {
    doc = input.doc
    rawJson = serializeInk(input)
  } else {
    doc = input
    rawJson = serializeInk(input)
  }

  let base64 = await gzipBase64(rawJson, options)
  let simplified = false
  const distances = [1, 2, 4, 8]
  for (const distance of distances) {
    if (base64.length <= maxBytes) break
    const candidate: InkDocument = {
      ...doc,
      strokes: doc.strokes.map((stroke) => ({ ...stroke, pts: simplifyPoints(stroke.pts, distance) })),
    }
    const candidateJson = serializeInk(candidate)
    const candidateBase64 = await gzipBase64(candidateJson, options)
    // 没变小就继续尝试更大的抽稀距离（1px 可能一个点都删不掉）
    if (candidateBase64.length >= base64.length) continue
    doc = candidate
    rawJson = candidateJson
    base64 = candidateBase64
    simplified = true
  }

  return {
    rawJson,
    base64,
    rawBytes: utf8ByteLength(rawJson),
    compressedBytes: base64Bytes(base64),
    simplified,
    overLimit: base64.length > maxBytes,
  }
}
