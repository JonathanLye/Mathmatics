import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { isIPv4 } from 'node:net';

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
// 输出是“掩码键”，不做 RFC 5952 的规范压缩（例如 2001:db8:0::/48），不要拿它当规范地址比较。

function maskIpv4(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

// 解析 IPv6 为 8 个 16 位分组；支持压缩、zone id、IPv4-mapped / NAT64 的内嵌 IPv4。
// 非法输入（多段 ::、分组数不对、:: 没有替代任何分组等）返回 null。
function parseIpv6(raw: string): number[] | null {
  let text = raw.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (text.includes('.')) {
    const colon = text.lastIndexOf(':');
    const v4 = text.slice(colon + 1);
    if (!isIPv4(v4)) return null;
    const [a, b, c, d] = v4.split('.').map(Number);
    text = `${text.slice(0, colon + 1)}${(((a as number) << 8) | (b as number)).toString(16)}:${(((c as number) << 8) | (d as number)).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0]!.split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 && fill < 1) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

export function maskIp(ip: string | undefined): string | null {
  const value = (ip ?? '').trim();
  if (value === '') return null;
  if (isIPv4(value)) return maskIpv4(value);

  const nums = parseIpv6(value);
  if (nums === null) return null;
  // IPv4-mapped（::ffff:0:0/96）：语义上是 IPv4，按 /24 记，避免把所有映射地址收进同一个桶。
  if (nums.slice(0, 5).every((n) => n === 0) && nums[5] === 0xffff) {
    const hi = nums[6] as number;
    const lo = nums[7] as number;
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.0/24`;
  }
  return `${nums.slice(0, 3).map((n) => n.toString(16)).join(':')}::/48`;
}

export function newAnonCode(prefix: 'S' | 'T'): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ANON_ALPHABET[randomInt(ANON_ALPHABET.length)];
  }
  return `${prefix}-${code}`;
}
