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
  // 每分钟、每会话的请求上限（见 routes/events.ts、routes/attempts.ts）。
  rateLimits: { events: number; help: number };
  // 含各 provider 的密钥（见 ai/registry.ts）：不得打印或序列化。
  models: ModelRegistry;
}

const DEV_SESSION_SECRET = 'proof-gym-dev-session-secret-not-for-production';
const DEV_PII_KEY = Buffer.from('proof-gym-dev-pii-key-0000000000', 'utf8');
const DEV_STUDENT_NO_PEPPER = 'proof-gym-dev-student-no-pepper-not-for-production';
const MODELS_PATH = fileURLToPath(new URL('../config/models.yaml', import.meta.url));

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数：${raw}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnv = (env.NODE_ENV ?? 'development') as AppEnv;
  const isProduction = appEnv === 'production';

  const sessionSecret = env.SESSION_SECRET ?? (isProduction ? '' : DEV_SESSION_SECRET);
  if (isProduction && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 必须在生产环境提供，且不少于 32 个字符');
  }

  const piiKey = env.PII_KEY ? Buffer.from(env.PII_KEY, 'base64') : isProduction ? Buffer.alloc(0) : DEV_PII_KEY;
  if (piiKey.length !== 32) {
    throw new Error('PII_KEY 必须是 base64 编码的 32 字节（AES-256 密钥）');
  }

  const studentNoPepper = env.STUDENT_NO_PEPPER ?? (isProduction ? '' : DEV_STUDENT_NO_PEPPER);
  if (isProduction && studentNoPepper.length < 32) {
    throw new Error('STUDENT_NO_PEPPER 必须在生产环境提供，且不少于 32 个字符');
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT 不合法：${String(env.PORT)}`);
  }

  return {
    env: appEnv,
    host: env.HOST ?? '127.0.0.1',
    port,
    logLevel: env.LOG_LEVEL ?? (appEnv === 'test' ? 'silent' : 'info'),
    sessionSecret,
    piiKey,
    studentNoPepper,
    databaseUrl: env.DATABASE_URL === undefined || env.DATABASE_URL === '' ? undefined : env.DATABASE_URL,
    pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
    rateLimits: {
      events: positiveInt(env.RATE_LIMIT_EVENTS_PER_MIN, 120, 'RATE_LIMIT_EVENTS_PER_MIN'),
      help: positiveInt(env.RATE_LIMIT_HELP_PER_MIN, 60, 'RATE_LIMIT_HELP_PER_MIN'),
    },
    models: loadModelRegistry(MODELS_PATH, env),
  };
}
