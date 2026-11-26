import { serveStatic } from '@hono/node-server/serve-static';
import { seedEdition } from './demo.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { connectMongo, disconnectMongo } from './db/client.js';
import { ensureIndexes } from './db/indexes.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error.js';
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1/index.js';
import type { App } from './types.js';

const app = new Hono<App>();

app.use('*', requestId());
app.use('*', corsMiddleware);
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
      requestId: c.get('requestId'),
    },
    'request',
  );
});

app.route('/health', healthRoutes);
app.route('/api/v1', v1Routes);

// Forward the browser SDK's sign-in calls only. Emulator administration stays internal.
for (const prefix of ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com']) {
  app.post('/' + prefix + '/v1/:action', async (c) => {
    const url = new URL(c.req.url);
    const response = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + url.pathname + url.search, {
      method: 'POST', headers: { 'content-type': c.req.header('content-type') || 'application/json' },
      body: await c.req.text(),
    });
    return new Response(response.body, { status: response.status, headers: {
      'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store',
    }});
  });
}
for (const file of ['/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/apple-touch-icon.png']) {
  app.get(file, serveStatic({ root: './public' }));
}
app.use('/assets/*', serveStatic({ root: './public' }));
for (const path of ['/', '/surveyor', '/admin', '/admin/*', '/surveyor/*']) {
  app.get(path, serveStatic({ path: './public/index.html' }));
}

app.notFound((c) => c.json({ error: { code: 'not_found' } }, 404));
app.onError(errorHandler);

async function main() {
  await connectMongo();
  await ensureIndexes();
  await seedEdition();

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
    logger.info({ port: info.port, env: env.NODE_ENV }, 'server listening'),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal error during startup');
  process.exit(1);
});
