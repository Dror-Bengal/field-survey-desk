import pino from 'pino';
import { env } from './env.js';

const isDev = env.NODE_ENV === 'development';
// Long-running ETL scripts need flushed output for progress visibility.
// Set ETL=1 in the environment to bypass pino-pretty transport (which buffers).
const isEtl = process.env.ETL === '1';

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    ...(isDev &&
      !isEtl && {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }),
    base: { service: 'voters-backend' },
    redact: {
      paths: ['req.headers.authorization', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
  },
  isEtl ? pino.destination({ sync: true }) : undefined,
);
