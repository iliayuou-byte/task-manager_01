import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import bot from './bot.js';
import { IS_PROD } from './core/config.js';
import { AppError } from './core/error.js';
import logger from './core/logger.js';
import { verifyCron } from './middlewares/verifyCron.js';
import { verifyGithubWebhook } from './middlewares/verifyGithubWebhook.js';
import { cronHandler } from './routes/cron.js';
import { githubWebhookHandler } from './routes/githubWebhook.js';
import { healthHandler } from './routes/health.js';
import { personalEnabled } from './services/personalStore.js';

const app = new Hono();

// Log incoming requests
app.use(async (c, next) => {
  logger.debugWithContext({
    message: `${c.req.method} ${c.req.url}`,
  });
  await next();
});

// Telegram webhook
// NOTE: Manual handler instead of grammY's webhookCallback due to
// @hono/node-server/vercel POST body hanging bug
// https://github.com/honojs/node-server/issues/84
app.post('/api', async (c) => {
  const secret = process.env.BOT_SECRET || undefined;
  if (personalEnabled() && !secret) {
    return c.json({ error: 'Webhook authentication required' }, 503);
  }
  const secretHeader = c.req.header('x-telegram-bot-api-secret-token');
  if (secret && secretHeader !== secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const update = await c.req.json();

  await bot.init();
  await bot.handleUpdate(update);
  return c.json({ ok: true });
});

// Routes
app.get('/api', healthHandler);
app.get('/api/cron', verifyCron, async (c) => cronHandler(c, bot));
app.post('/api/github-webhook', verifyGithubWebhook, async (c) =>
  githubWebhookHandler(c, bot),
);

// 404 handler
app.notFound((c) => {
  return c.json(
    { error: 'Not Found', message: 'The requested endpoint does not exist' },
    404,
  );
});

// Global error handler
app.onError((err, c) => {
  logger.errorWithContext({
    op: 'APP_ERROR',
    error: err.message,
  });

  const isOperational = err instanceof AppError;
  const statusCode = isOperational ? err.statusCode : 500;
  const message = isOperational ? err.message : 'Internal Server Error';

  return c.json(
    {
      error: message,
      ...(!IS_PROD && { stack: err.stack }),
    },
    statusCode as ContentfulStatusCode,
  );
});

export default app;
