/**
 * 事件 SDK 的 ID 工具（08 §2 事件信封）：事件 id 用 uuid v7（客户端生成，重试不变用于去重）。
 * 不引入第三方依赖：直接用时间戳 + crypto 随机数拼 v7 格式；无 crypto 时退回 Math.random（仅测试/旧环境）。
 */

const HEX = '0123456789abcdef'

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
    return bytes
  }
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

function hexOf(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += HEX[(bytes[i] >> 4) & 0x0f] + HEX[bytes[i] & 0x0f]
  return out
}

/** 生成 uuid v7（48-bit 毫秒时间戳 + version 7 + variant + 随机）。 */
export function uuidv7(nowMs: number = Date.now()): string {
  const ts = Math.max(0, Math.floor(nowMs)).toString(16).padStart(12, '0').slice(-12)
  const random = hexOf(randomBytes(10)) // 20 hex chars
  const version = '7' + random.slice(0, 3)
  const variantNibble = ((parseInt(random[3], 16) & 0x3) | 0x8).toString(16)
  const variant = variantNibble + random.slice(4, 7)
  const node = random.slice(7, 19)
  return ts.slice(0, 8) + '-' + ts.slice(8, 12) + '-' + version + '-' + variant + '-' + node
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 是否是合法的 uuid 字符串（events.schema.json 的 format: uuid 校验用）。 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
