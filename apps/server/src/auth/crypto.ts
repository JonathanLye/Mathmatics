import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

// 05 §7：学号、姓名 AES-256-GCM 加密；IV 为 96 位随机数（NIST SP 800-38D 推荐长度），标签 128 位。
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ANON_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function encryptPii(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptPii(key: Buffer, blob: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, IV_BYTES));
  decipher.setAuthTag(blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(blob.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

// 学号匹配用 HMAC-SHA256(pepper)；名单导入（教师端）必须用同一函数计算 roster_entries.student_no_hash。
export function studentNoHash(pepper: string, studentNo: string): string {
  return createHmac('sha256', pepper).update(normalizeStudentNo(studentNo), 'utf8').digest('hex');
}

export function normalizeStudentNo(studentNo: string): string {
  return studentNo.normalize('NFKC').trim();
}

export function normalizeInviteCode(inviteCode: string): string {
  return inviteCode.trim().toUpperCase();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

// IP 存 /24 掩码（05 §7）。非 IPv4 暂不记录（P0 不做 IPv6 掩码）。
export function maskIp(ip: string | undefined): string | null {
  const match = /^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip ?? '');
  return match ? `${match[1]}.0/24` : null;
}

export function newAnonCode(prefix: 'S' | 'T'): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ANON_ALPHABET[randomInt(ANON_ALPHABET.length)];
  }
  return `${prefix}-${code}`;
}
