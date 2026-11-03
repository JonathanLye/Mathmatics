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

// IP 存掩码（05 §7）：IPv4 存 /24，IPv6 存 /48（运营商通常给用户分配 /48–/64，/48 之后的位可以直接识别到个人）。
// 手机网络越来越多是 IPv6，只处理 IPv4 会让这类会话没有任何来源记录。解析不了的返回 null。
export function maskIp(ip: string | undefined): string | null {
  const v4 = /^(?:::ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip ?? '');
  if (v4) return `${v4[1]}.0/24`;

  const bare = (ip ?? '').split('%')[0] ?? ''; // 去掉 zone id（fe80::1%eth0）
  if (!/^[0-9a-f:]+$/i.test(bare) || !bare.includes(':')) return null;
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : (halves[0] ?? '').split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : (halves[1] ?? '').split(':')) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/48`;
}

export function newAnonCode(prefix: 'S' | 'T'): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ANON_ALPHABET[randomInt(ANON_ALPHABET.length)];
  }
  return `${prefix}-${code}`;
}
