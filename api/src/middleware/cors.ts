import { cors } from 'hono/cors';
import { env } from '../env.js';

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return null;
    return env.CORS_ORIGINS.includes(origin) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Client-Timestamp'],
  exposeHeaders: ['X-Request-Id'],
  credentials: true,
  maxAge: 600,
});
