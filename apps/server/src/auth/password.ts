import { hash, verify, type Options } from '@node-rs/argon2';

import { AppError } from '../errors.ts';

import { normalizeStudentNo } from './crypto.ts';

// 学生 / 教师密码的共用模块：argon2id 参数、带并发上限的哈希与校验、学生密码策略。
// 服务端只有 1 个 CPU、320MB 内存：每次 argon2 要占 19 MiB，所以全进程同时最多 2 个，其余排队，队列满了立即拒绝。
// 调用方必须在数据库事务**之外**调用 hashPassword / verifyPassword（不要把一次 CPU 密集计算压在持有连接的事务里）。
// 本文件要能被 Node 原生类型剥离直接运行（tools/reset-teacher-password.mjs 会 import）：只用可擦除的类型语法，import 带 .ts 后缀。

// OWASP 密码存储指南的 Argon2id 最低配置：m=19 MiB、t=2、p=1。
// @node-rs/argon2 的 Algorithm 是 const enum，Node 原生类型剥离不支持，因此直接写数值 2（argon2id）。
export const HASH_OPTIONS: Options = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MAX_CONCURRENT_HASHES = 2;
// 排队上限：正常情况下一个班同时登录也就几十人，超过说明在被打，快速失败比让请求挂着更好。
export const MAX_QUEUED_HASHES = 64;

export interface ConcurrencyLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createConcurrencyLimiter(concurrency: number, maxQueue: number): ConcurrencyLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      if (waiting.length >= maxQueue) throw new AppError('RATE_LIMITED', 429, '现在登录的人太多了，请稍后再试');
      // 名额由释放方直接交接（active 不先减后加），排队的人不会被后来的人插队。
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  return { run };
}

const hashLimiter = createConcurrencyLimiter(MAX_CONCURRENT_HASHES, MAX_QUEUED_HASHES);

export function hashPassword(password: string): Promise<string> {
  return hashLimiter.run(() => hash(password, HASH_OPTIONS));
}

// 哈希损坏 / 格式不对一律当作“不匹配”，不向外抛（调用方统一回“账号或密码不对”）。
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return hashLimiter.run(async () => {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  });
}

// 账号不存在 / 没设密码时也做一次校验，让响应时间与“密码错误”接近，避免靠耗时枚举学号。惰性计算：不拖慢进程启动。
let timingDummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<void> {
  timingDummyHash ??= hashPassword('timing-equalizer-not-a-real-password');
  await verifyPassword(await timingDummyHash, password);
}

export const MIN_STUDENT_PASSWORD_LENGTH = 8;
export const MAX_STUDENT_PASSWORD_LENGTH = 64;

// 常见弱密码（小写；查表前把输入转小写）。覆盖键盘序、纯数字、password/admin 一类、拼音经典（woaini1314 等）、
// 以及本产品相关词。不足 8 位的项无意义（长度下限先拦），这里一律 ≥ 8 位。
export const WEAK_PASSWORDS: ReadonlySet<string> = new Set([
  '12345678', '123456789', '1234567890', '0123456789', '987654321', '9876543210', '87654321',
  '11111111', '22222222', '33333333', '44444444', '55555555', '66666666', '77777777', '88888888',
  '99999999', '00000000', '111111111', '1111111111', '123123123', '123321123', '12341234',
  '12345679', '123456789a', '1234567a', '123456abc', 'abc12345', 'abcd1234', 'abcd12345',
  'a1234567', 'a12345678', 'a123456789', 'aa123456', 'aaaa1111', 'aaaaaaaa', 'abcdefgh',
  'abcdefghi', 'abcdefghij', 'qwertyui', 'qwertyuio', 'qwertyuiop', 'qwerty123', 'qwerty1234',
  'qwerty12345', 'qwer1234', 'qwer12345', 'asdfghjk', 'asdfghjkl', 'asdf1234', 'asdfgh123',
  'zxcvbnm1', 'zxcvbnmm', 'zxcvbnm123', '1qaz2wsx', '1q2w3e4r', '1q2w3e4r5t', '1qazxsw2',
  'qazwsxedc', 'q1w2e3r4', 'q1w2e3r4t5', 'password', 'password1', 'password12', 'password123',
  'password1234', 'passw0rd', 'pass1234', 'pass12345', 'passw0rd1', 'p@ssw0rd', 'p@ssword',
  'p@ssword1', 'admin123', 'admin1234', 'admin12345', 'administrator', 'adminadmin', 'root1234',
  'letmein1', 'letmein123', 'welcome1', 'welcome123', 'iloveyou', 'iloveyou1', 'iloveyou123',
  'monkey123', 'dragon123', 'football1', 'baseball1', 'sunshine1', 'princess1', 'superman1',
  'trustno1', 'changeme', 'changeme1', 'changeit1', 'test1234', 'test12345', 'testtest',
  'testing123', 'student1', 'student123', 'student12', 'teacher123', 'school123', 'school2024',
  'school2025', 'school2026', 'mathmath', 'math1234', 'math12345', 'math123456', 'shuxue123',
  'proofgym', 'proof1234', 'proofgym1', 'proofgym123', 'zhengming', 'zhengming1', 'woaini1314',
  'woaini520', 'woaini5201314', 'woaini123', 'woaini1234', 'woaini12345', '5201314a', '52013145',
  '520520520', '5201314520', '1314520a', '13145200', '13141314', '14781478', 'aini1314',
  'iloveyou1314', 'wo158158', 'woshishen', 'woshiwo123', 'wangwang1', 'wangwang123', 'laoshi123',
  'xuesheng123', 'xuexi123', 'xuexiaoxiao', 'a1b2c3d4', 'a1b2c3d4e5', 'aa11bb22', 'abc123456',
  'abc1234567', 'abcabc123', 'abc123abc', 'zxc12345', 'zxc123456', 'zxcvbnm!', 'qq123456',
  'qq1234567', 'qq12345678', 'qq5201314', 'qqqq1111', 'qqqqqqqq', 'wx123456', 'weixin123',
  'woaiwo123', 'mima1234', 'mima12345', 'mima123456', 'mimamima', 'mimamima1', 'mm123456',
  'aa1234567', 'wang1234', 'zhang123', 'li123456', 'liu123456', 'chen1234', 'zhao1234', 'yang1234',
  'huang123', 'zhou1234', 'wu123456', 'xu123456', 'sun12345', 'ma123456', 'zhu12345', 'hu123456',
  'guo12345', 'he123456', 'gao12345', 'lin12345', 'luo12345', 'liang123', 'song1234', 'tang1234',
  'xiaoming1', 'xiaohong1', 'jiayou123', 'jiayou2024', 'hello123', 'hello1234', 'hello12345',
  'helloworld', 'hello1234!', 'welcome!', '12qwaszx', '1qaz1qaz', '123qweasd', '123qwe123',
  'qwe123456', 'qwe123qwe', 'qweasdzxc', '1234qwer', '12345qwert', 'abc@1234', 'abc@12345',
  'qwer@1234', 'pa55word', 'pa55w0rd', 'temp1234', 'default1', 'guest1234', 'iloveu123',
  'loveyou123', '112233445', '1122334455', '11223344', '12121212', '21212121', '13131313',
  '20202020', '20232023', '20242024', '20252025', '20262026', '2023.2024', '20000000', '19900101',
  '19800101', '20000101', '20010101',
]);

// 通过返回 null，不通过返回可直接展示给学生的中文原因。长度按字符（码点）计，不按字节。
export function checkPasswordPolicy(password: string, studentNo: string): string | null {
  const length = [...password].length;
  if (length < MIN_STUDENT_PASSWORD_LENGTH) return `密码至少 ${MIN_STUDENT_PASSWORD_LENGTH} 个字符`;
  if (length > MAX_STUDENT_PASSWORD_LENGTH) return `密码最多 ${MAX_STUDENT_PASSWORD_LENGTH} 个字符`;
  if (password === studentNo || normalizeStudentNo(password) === normalizeStudentNo(studentNo)) return '密码不能和学号一样';
  if (WEAK_PASSWORDS.has(password.toLowerCase()) || new Set(password).size === 1) {
    return '这个密码太常见了，换一个不容易被猜到的';
  }
  return null;
}
