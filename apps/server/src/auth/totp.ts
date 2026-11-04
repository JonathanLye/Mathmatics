import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// 教师登录的 TOTP 二次验证（RFC 6238，HMAC-SHA1，6 位 / 30 秒）。
// 不引入第三方依赖：算法短且稳定，标准库足够；密钥用 base32 存储（验证器 App 的通用格式）。
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
// 允许前后各一个时间步，容忍手机与服务器的时钟漂移（TOTP 的常见做法）。
export const TOTP_WINDOW_STEPS = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// 解码容忍小写、空格、填充与常见分隔符（运维从验证器 App 复制过来时可能带）。
export function base32Decode(text: string): Buffer {
  const normalized = text.toUpperCase().replace(/[\s=_-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`非法的 base32 字符：${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160 位随机密钥 = 32 个 base32 字符，验证器 App 的默认长度。
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function codeAtCounter(secretBytes: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secretBytes).update(message).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    ((hmac[offset] ?? 0) & 0x7f) * 0x1000000 +
    ((hmac[offset + 1] ?? 0) & 0xff) * 0x10000 +
    ((hmac[offset + 2] ?? 0) & 0xff) * 0x100 +
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

// 指定时间点（毫秒）的验证码；测试与生成共用同一实现。
export function totpCode(secret: string, timeMs: number, period = TOTP_PERIOD_SEC): string {
  const counter = Math.floor(timeMs / 1000 / period);
  return codeAtCounter(base32Decode(secret), counter);
}

// 验证码校验：6 位数字、常数时间比较、容忍 ±TOTP_WINDOW_STEPS 个时间步。
export function verifyTotp(secret: string, code: string, timeMs = Date.now(), windowSteps = TOTP_WINDOW_STEPS): boolean {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return false;
  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secret);
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;
  const counter = Math.floor(timeMs / 1000 / TOTP_PERIOD_SEC);
  const expected = Buffer.from(code);
  for (let step = -windowSteps; step <= windowSteps; step += 1) {
    const candidate = Buffer.from(codeAtCounter(secretBytes, counter + step));
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}
