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
  // 含各 provider 的密钥（见 ai/registry.ts）：不得打印或序列化。
  models: ModelRegistry;
}

const DEV_SESSION_SECRET = 'proof-gym-dev-session-secret-not-for-production';
const DEV_PII_KEY = Buffer.from('proof-gym-dev-pii-key-0000000000', 'utf8');
const DEV_STUDENT_NO_PEPPER = 'proof-gym-dev-student-no-pepper-not-for-production';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost']);
const MODELS_PATH = fileURLToPath(new URL('../config/models.yaml', import.meta.url));

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

  // 开发用的写死密钥只允许在本机回环上用：NODE_ENV 没设（默认 development）又监听在非回环地址时，
  // 等于把可伪造会话的公开密钥暴露出去，启动即失败。
  const host = env.HOST ?? '127.0.0.1';
  const usesDevSecrets = !isProduction && (env.SESSION_SECRET === undefined || env.PII_KEY === undefined || env.STUDENT_NO_PEPPER === undefined);
  if (usesDevSecrets && !LOOPBACK_HOSTS.has(host)) {
    throw new Error(`HOST=${host} 不是回环地址，但 SESSION_SECRET / PII_KEY / STUDENT_NO_PEPPER 没有全部提供（会使用写死的开发密钥）。请提供密钥并设置 NODE_ENV=production`);
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
    models: loadModelRegistry(MODELS_PATH, env),
  };
}
