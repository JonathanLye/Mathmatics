import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
  logger.fatal('DATABASE_URL is required');
  process.exit(1);
}

logger.info({ queue: 'proof-gym' }, 'worker skeleton ready');
