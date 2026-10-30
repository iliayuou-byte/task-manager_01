import bot from './bot.js';
import { COMMANDS } from './core/config.js';
import logger from './core/logger.js';
import { startInputRetryLoop } from './services/pendingInputs.js';
import { checkPersonalReminders } from './services/personalNotifications.js';
import { startReminderLoop } from './services/reminders.js';

const webhook = await bot.api.getWebhookInfo();
if (webhook.url) {
  throw new Error(
    'A webhook is active. Remove it explicitly before running polling.',
  );
}
await bot.api.setMyCommands(
  Object.entries(COMMANDS).map(([command, value]) => ({
    command,
    description: value.desc,
  })),
);
let stopInputRetries: (() => void) | undefined;
let stopReminders: (() => void) | undefined;
let personalTimer: ReturnType<typeof setInterval> | undefined;
let personalRunning = false;
const checkPersonal = async () => {
  if (personalRunning) return;
  personalRunning = true;
  try {
    await checkPersonalReminders((id, text, options) =>
      bot.api.sendMessage(id, text, options),
    );
  } catch {
    logger.warnWithContext({
      op: 'PERSONAL_REMINDERS',
      message: 'Personal reminder check failed',
    });
  } finally {
    personalRunning = false;
  }
};
const stop = () => {
  stopInputRetries?.();
  stopReminders?.();
  if (personalTimer) clearInterval(personalTimer);
  if (bot.isRunning()) void bot.stop();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await bot.start({
    onStart: () => {
      logger.infoWithContext({ message: 'Copilot polling started' });
      stopReminders = startReminderLoop(bot);
      stopInputRetries = startInputRetryLoop(bot);
      void checkPersonal();
      personalTimer = setInterval(() => {
        void checkPersonal();
      }, 60000);
    },
  });
} finally {
  stop();
}
