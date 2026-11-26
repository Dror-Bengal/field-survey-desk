import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import type { App } from '../types.js';

export const healthRoutes = new Hono<App>();

healthRoutes.get('/', (c) => c.json({ status: 'ok', service: 'voters-backend' }));

healthRoutes.get('/ready', async (c) => {
  try {
    await getDb().command({ ping: 1 });
    return c.json({ status: 'ready', mongo: 'up' });
  } catch (err) {
    return c.json({ status: 'not_ready', mongo: 'down', error: (err as Error).message }, 503);
  }
});
