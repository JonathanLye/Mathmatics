// 配置加载（05 §8）。生产必须提供真实密钥：SESSION_SECRET / PII_KEY / STUDENT_NO_PEPPER。
// 下面的 DEV_* 是开发/测试用的写死密钥，只允许本机回环使用，**禁止用于部署**；
// NODE_ENV 未设（默认 development）又监听非回环地址时启动即失败。
import { fileURLToPath } from 'node:url';

import { loadModelRegistry, type ModelRegistry } from './ai/registry.ts';

export type AppEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  env: AppEnv;
  host: string;
  port: number;
  logLevel: string;
  sessionSecret: string;
  piiKey: Buffer;
  studentNoPepper: string;
  databaseUrl?: string;
  pgliteDir: string;
  // GET /health/details 的访问令牌（请求头 x-health-token）。未配置则明细接口一律 404。
  healthToken?: string;
  // 每分钟、每会话的请求上限（见 routes/events.ts、routes/attempts.ts）。
  // login = 每 IP 每分钟学生登录上限（校园共用出口 IP，多个班同时登录时调大）；缺省 120。
  rateLimits: { events: number; help: number; login?: number };
  // 识别（03 §3、09 §10）：每生每日上限、全局并发（= 已购 SimpleTex QPS）、每生同时在途数、照片落盘目录。
  recognition: { inkPerDay: number; photoPerDay: number; concurrency: number; perUserConcurrency: number; storageDir: string };
  // 模型回答（U15）：每生限流、每日预算、并发、单次调用超时。预算为 null 表示不设上限。
  ai: {
    dailyBudgetCny: number | null;
    studentCallsPer10Min: number;
    concurrency: number;
    perUserConcurrency: number;
    genTimeoutMs: number;
    reviewTimeoutMs: number;
    // 结构化小判定（软规则复核、L1/L2 语义判定、兜底归类）的单次超时
    classifyTimeoutMs: number;
    totalMs: number;
  };
  // 含各 provider 的密钥（见 ai/registry.ts）：不得打印或序列化。
  models: ModelRegistry;
}

const DEV_SESSION_SECRET = 'proof-gym-dev-session-secret-not-for-production';
const DEV_PII_KEY = Buffer.from('proof-gym-dev-pii-key-0000000000', 'utf8');
const DEV_STUDENT_NO_PEPPER = 'proof-gym-dev-student-no-pepper-not-for-production';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);
const MODELS_PATH = fileURLToPath(new URL('../config/models.yaml', import.meta.url));

// 空串等于没提供：不能拿 '' 当密钥（会被当成“已提供”而绕过回环守卫）。
function configured(raw: string | undefined): raw is string {
  return raw !== undefined && raw !== '';
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数：${raw}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnv = (env.NODE_ENV ?? 'development') as AppEnv;
  const isProduction = appEnv === 'production';

  const host = env.HOST ?? '127.0.0.1';
  const loopback = LOOPBACK_HOSTS.has(host);
  const sessionSecret = configured(env.SESSION_SECRET) ? env.SESSION_SECRET : isProduction ? '' : DEV_SESSION_SECRET;
  const piiKey = configured(env.PII_KEY) ? Buffer.from(env.PII_KEY, 'base64') : isProduction ? Buffer.alloc(0) : DEV_PII_KEY;
  const studentNoPepper = configured(env.STUDENT_NO_PEPPER) ? env.STUDENT_NO_PEPPER : isProduction ? '' : DEV_STUDENT_NO_PEPPER;
  if (piiKey.length !== 32) {
    throw new Error('PII_KEY 必须是 base64 编码的 32 字节（AES-256 密钥）');
  }

  // 开发用的写死密钥只允许在本机回环上用：NODE_ENV 没设（默认 development）又监听在非回环地址时，
  // 等于把可伪造会话的公开密钥暴露出去，启动即失败。空串按“没提供”处理。
  const usesDevSecrets =
    !isProduction && (!configured(env.SESSION_SECRET) || !configured(env.PII_KEY) || !configured(env.STUDENT_NO_PEPPER));
  if (usesDevSecrets && !loopback) {
    throw new Error(`HOST=${host} 不是回环地址，但 SESSION_SECRET / PII_KEY / STUDENT_NO_PEPPER 没有全部提供（会使用写死的开发密钥）。请提供密钥并设置 NODE_ENV=production`);
  }
  // 生产或非回环（即使显式给了密钥）都要求至少 32 字符；空串/短串不能蒙混成“已提供”。
  if ((isProduction || !loopback) && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 必须在生产环境或非回环监听时提供，且不少于 32 个字符');
  }
  if ((isProduction || !loopback) && studentNoPepper.length < 32) {
    throw new Error('STUDENT_NO_PEPPER 必须在生产环境或非回环监听时提供，且不少于 32 个字符');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT 不合法：${String(env.PORT)}`);
  }

  return {
    env: appEnv,
    host,
    port,
    logLevel: env.LOG_LEVEL ?? (appEnv === 'test' ? 'silent' : 'info'),
    sessionSecret,
    piiKey,
    studentNoPepper,
    databaseUrl: env.DATABASE_URL === undefined || env.DATABASE_URL === '' ? undefined : env.DATABASE_URL,
    pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
    ...(configured(env.HEALTH_TOKEN) ? { healthToken: env.HEALTH_TOKEN } : {}),
    rateLimits: {
      events: positiveInt(env.RATE_LIMIT_EVENTS_PER_MIN, 120, 'RATE_LIMIT_EVENTS_PER_MIN'),
      help: positiveInt(env.RATE_LIMIT_HELP_PER_MIN, 60, 'RATE_LIMIT_HELP_PER_MIN'),
      login: positiveInt(env.RATE_LIMIT_LOGIN_PER_MIN, 120, 'RATE_LIMIT_LOGIN_PER_MIN'),
    },
    recognition: {
      inkPerDay: positiveInt(env.RECOG_INK_PER_DAY, 300, 'RECOG_INK_PER_DAY'),
      photoPerDay: positiveInt(env.RECOG_PHOTO_PER_DAY, 30, 'RECOG_PHOTO_PER_DAY'),
      concurrency: positiveInt(env.RECOG_CONCURRENCY, 5, 'RECOG_CONCURRENCY'),
      perUserConcurrency: positiveInt(env.RECOG_PER_USER_CONCURRENCY, 2, 'RECOG_PER_USER_CONCURRENCY'),
      storageDir: env.STORAGE_DIR ?? '.data/photos',
    },
    ai: {
      dailyBudgetCny: env.AI_DAILY_BUDGET_CNY === undefined || env.AI_DAILY_BUDGET_CNY === '' ? null : Number(env.AI_DAILY_BUDGET_CNY),
      studentCallsPer10Min: positiveInt(env.AI_STUDENT_CALLS_PER_10MIN, 20, 'AI_STUDENT_CALLS_PER_10MIN'),
      concurrency: positiveInt(env.AI_CONCURRENCY, 6, 'AI_CONCURRENCY'),
      perUserConcurrency: positiveInt(env.AI_PER_USER_CONCURRENCY, 2, 'AI_PER_USER_CONCURRENCY'),
      genTimeoutMs: 6000,
      reviewTimeoutMs: 5000,
      classifyTimeoutMs: 4000,
      totalMs: 12000,
    },
    models: loadModelRegistry(MODELS_PATH, env),
  };
}
