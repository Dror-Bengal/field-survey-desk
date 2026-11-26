import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { logger } from '../logger.js';
import type { App } from '../types.js';

export const errorHandler: ErrorHandler<App> = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      { error: { code: err.message || 'http_exception', message_en: err.message } },
      err.status,
    );
  }

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'validation_error',
          message_en: 'request validation failed',
          details: err.flatten(),
        },
      },
      400,
    );
  }

  logger.error({ err, path: c.req.path }, 'unhandled error');
  return c.json({ error: { code: 'internal_error', message_en: 'internal server error' } }, 500);
};
