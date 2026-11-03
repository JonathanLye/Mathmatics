import { describe, expect, it } from 'vitest';

import { decryptPii, encryptPii, maskIp, newAnonCode, studentNoHash } from '../src/auth/crypto.ts';
import { loadConfig } from '../src/config.ts';

const key = loadConfig({ NODE_ENV: 'test' }).piiKey;

describe('个人信息加密（AES-256-GCM）', () => {
  it('解密还原明文；每次加密的密文不同（随机 IV）', () => {
    const a = encryptPii(key, '2026001');
    const b = encryptPii(key, '2026001');

    expect(decryptPii(key, a)).toBe('2026001');
    expect(a.equals(b)).toBe(false);
  });

  it('密文被篡改时解密失败（GCM 认证标签）', () => {
    const blob = encryptPii(key, '2026001');
    blob[blob.length - 1] ^= 0x01;

    expect(() => decryptPii(key, blob)).toThrow();
  });

  it('PII_KEY 必须是 32 字节', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', PII_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/PII_KEY/);
    expect(loadConfig({ NODE_ENV: 'test', PII_KEY: Buffer.alloc(32, 1).toString('base64') }).piiKey.length).toBe(32);
  });
});

describe('学号哈希与掩码', () => {
  it('学号哈希稳定、按 NFKC 与首尾空白归一，且依赖 pepper', () => {
    const pepper = 'x'.repeat(32);
    expect(studentNoHash(pepper, ' ２０２６００１ ')).toBe(studentNoHash(pepper, '2026001'));
    expect(studentNoHash(pepper, '2026001')).not.toBe(studentNoHash('y'.repeat(32), '2026001'));
  });

  it('IP 存 /24 掩码，非 IPv4 返回 null', () => {
    expect(maskIp('203.0.113.77')).toBe('203.0.113.0/24');
    expect(maskIp('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(maskIp('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(maskIp('2001:0DB8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3::/48');
    expect(maskIp('::1')).toBe('0:0:0::/48');
    expect(maskIp('fe80::1%eth0')).toBe('fe80:0:0::/48');
    expect(maskIp('1:2:3:4:5:6:7:8')).toBe('1:2:3::/48');
    expect(maskIp('2001:db8:ffff::1')).toBe('2001:db8:ffff::/48');
    expect(maskIp('::FFFF:203.0.113.77')).toBe('203.0.113.0/24');
    expect(maskIp('::ffff:c000:0285')).toBe('192.0.2.0/24');
    expect(maskIp('64:ff9b::192.0.2.33')).toBe('64:ff9b:0::/48');
    expect(maskIp('999.999.999.999')).toBeNull();
    expect(maskIp('not-an-ip')).toBeNull();
    expect(maskIp('1::2::3')).toBeNull();
    expect(maskIp('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(maskIp('1:2:3:4:5:6:7:8::')).toBeNull();
    expect(maskIp('::1:2:3:4:5:6:7:8')).toBeNull();
    expect(maskIp(undefined)).toBeNull();
  });

  it('匿名码形如 S-XXXXXX，字母表不含易混字符', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newAnonCode('S')).toMatch(/^S-[2-9A-HJKMNP-Z]{6}$/);
    }
  });
});

describe('生产环境配置校验', () => {
  it('生产环境缺 PII_KEY 或 STUDENT_NO_PEPPER 时拒绝启动', () => {
    const base = { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(40) };

    expect(() => loadConfig({ ...base, STUDENT_NO_PEPPER: 'p'.repeat(40) })).toThrow(/PII_KEY/);
    expect(() => loadConfig({ ...base, PII_KEY: Buffer.alloc(32, 2).toString('base64') })).toThrow(/STUDENT_NO_PEPPER/);
    expect(
      loadConfig({
        ...base,
        PII_KEY: Buffer.alloc(32, 2).toString('base64'),
        STUDENT_NO_PEPPER: 'p'.repeat(40),
      }).env,
    ).toBe('production');
  });
});
