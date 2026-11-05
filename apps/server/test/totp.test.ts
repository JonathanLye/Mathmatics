import { describe, expect, it } from 'vitest';

import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from '../src/auth/totp.ts';

// RFC 6238 的 SHA-1 测试密钥（ASCII "12345678901234567890"）与时间点。
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP（RFC 6238，HMAC-SHA1 / 6 位 / 30 秒）', () => {
  it('base32 编解码往返（RFC 4648 向量）', () => {
    expect(base32Encode(Buffer.from('1234567890', 'ascii'))).toBe('GEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQ').toString('ascii')).toBe('1234567890');
    // 容忍小写、空格与填充。
    expect(base32Decode('gezd gnbv gy3t qojq==').toString('ascii')).toBe('1234567890');
  });

  it('RFC 6238 附录 B 的 SHA-1 测试向量（截断为 6 位）', () => {
    const cases: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, expected] of cases) {
      expect(totpCode(RFC_SECRET, seconds * 1000), `T=${seconds}`).toBe(expected);
    }
  });

  it('verifyTotp：当前码通过、错误码拒绝、容忍 ±1 步、拒绝非法格式', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const current = totpCode(secret, now);
    expect(verifyTotp(secret, current, now)).toBe(true);

    const wrong = current === '000000' ? '111111' : '000000';
    expect(verifyTotp(secret, wrong, now)).toBe(false);
    expect(verifyTotp(secret, '12345', now)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false);

    // 前一个/后一个时间步仍然有效（时钟漂移），再远一步无效。
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 120_000), now)).toBe(false);
  });

  it('generateTotpSecret 生成 32 个 base32 字符（160 位），每次不同', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
  });
});
