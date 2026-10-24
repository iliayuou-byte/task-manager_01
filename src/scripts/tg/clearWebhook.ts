import { Api } from 'grammy';
import logger from '../../core/logger.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN in env file');

try {
  await new Api(token).deleteWebhook({ drop_pending_updates: false });
  logger.infoWithContext({
    op: 'CLEAR_WEBHOOK',
    message: 'Webhook removed; pending updates preserved. Start polling now.',
  });
} catch {
  logger.errorWithContext({
    op: 'CLEAR_WEBHOOK',
    message:
      'Could not remove webhook. Check the local token and network connection.',
  });
  process.exitCode = 1;
}
