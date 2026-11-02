export type AppEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  env: AppEnv;
  host: string;
  port: number;
  logLevel: string;
  sessionSecret: string;
  databaseUrl?: string;
  pgliteDir: string;
}

const DEV_SESSION_SECRET = 'proof-gym-dev-session-secret-not-for-production';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appEnv = (env.NODE_ENV ?? 'development') as AppEnv;
  const sessionSecret = env.SESSION_SECRET ?? (appEnv === 'production' ? '' : DEV_SESSION_SECRET);
  if (appEnv === 'production' && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 必须在生产环境提供，且不少于 32 个字符');
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
    databaseUrl: env.DATABASE_URL === undefined || env.DATABASE_URL === '' ? undefined : env.DATABASE_URL,
    pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
  };
}
