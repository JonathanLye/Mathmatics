import pino from 'pino';

import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { sweepExports } from './services/teacher/exports.ts';
import { cleanupExpiredIdempotencyKeys } from './idempotency.ts';
import { requestSerializer } from './logging.ts';
import { probeStorageDir } from './recognition/storage.ts';
import { refreshStaleMetrics } from './metrics/refresh.ts';

const config = loadConfig();
// 先建 pino 实例：池里空闲连接的错误发生在 app 建立之后，但只有共用同一个 logger 才能进结构化日志。
const logger = pino({ level: config.logLevel, serializers: { req: requestSerializer } });
const db = await openDb({
  databaseUrl: config.databaseUrl,
  pgliteDir: config.pgliteDir,
  onPoolError: (error) => logger.error({ err: error }, 'pg pool idle client error'),
});
const app = await buildApp({ config, db, loggerInstance: logger });

// 照片落盘目录不可写时只警告（不崩溃）：学生仍可用键盘/手写，拍照接口会返回 503。常见原因：容器以 node 运行而目录归 root、命名卷未挂载。
const storage = await probeStorageDir(config.recognition.storageDir);
if (!storage.ok) {
  logger.warn({ storageDir: config.recognition.storageDir, reason: storage.error }, 'STORAGE_DIR 不可写：拍照识别将返回 503');
}

// 24h 过期的幂等键：不只靠带键请求“顺手清理”，低频时也要有人删。unref 不阻止进程退出。
const cleanupTimer = setInterval(
  () => {
    cleanupExpiredIdempotencyKeys(db).catch((error: unknown) => {
      app.log.error({ err: error }, 'idempotency: 清理过期键失败');
    });
    // 导出文件是学生数据副本，过期删除（04 §9）；进程重启遗留的任务标失败。
    sweepExports(db).catch((error: unknown) => {
      app.log.error({ err: error }, 'exports: 清理过期导出失败');
    });
  },
  60 * 60 * 1000,
);
cleanupTimer.unref();

// 派生指标（07 §1 原则 5：可随时重算）：没有 pg-boss worker 的部署由本进程定时刷新，启动时先补一轮。
// METRICS_REFRESH_SEC=0 关闭。测试不经过 server.ts，所以不会起这个定时器。
const metricsEverySec = Number(process.env.METRICS_REFRESH_SEC ?? 300);
let metricsTimer: NodeJS.Timeout | undefined;
if (Number.isFinite(metricsEverySec) && metricsEverySec > 0) {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    refreshStaleMetrics(db)
      .then((n) => {
        if (n > 0) app.log.info({ refreshed: n }, 'metrics: 已刷新派生指标');
      })
      .catch((error: unknown) => app.log.error({ err: error }, 'metrics: 刷新失败'))
      .finally(() => {
        running = false;
      });
  };
  tick();
  metricsTimer = setInterval(tick, metricsEverySec * 1000);
  metricsTimer.unref();
}

const address = await app.listen({ host: config.host, port: config.port });
if (process.env.SMOKE === '1') {
  console.log(`LISTENING ${address}`);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    clearInterval(cleanupTimer);
    if (metricsTimer) clearInterval(metricsTimer);
    app
      .close()
      .then(() => db.close())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}
