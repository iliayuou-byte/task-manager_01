import bot from './bot.js';
import logger from './core/logger.js';
import { checkPersonalReminders } from './services/personalNotifications.js';
import { personalEnabled } from './services/personalStore.js';

let running = false;
const tick = async () => {
  if (running || !personalEnabled()) return;
  running = true;
  try {
    await checkPersonalReminders((id, text) => bot.api.sendMessage(id, text));
  } catch {
    logger.errorWithContext({
      op: 'SCHEDULER',
      message: 'Reminder check failed; next check in one minute',
    });
  } finally {
    running = false;
  }
};

await bot.init();
await bot.api.deleteWebhook({ drop_pending_updates: false });
const timer = setInterval(() => {
  void tick();
}, 60000);
void tick();
const stop = () => {
  clearInterval(timer);
  if (bot.isRunning()) void bot.stop();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
logger.infoWithContext({
  op: 'POLLING',
  message: 'Bot started with local reminder scheduler',
});
try {
  await bot.start();
} finally {
  clearInterval(timer);
}
