import bot from './bot.js';
import { COMMANDS } from './core/config.js';
import logger from './core/logger.js';
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
let stopReminders: (() => void) | undefined;
const stop = () => {
  stopReminders?.();
  bot.stop();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
await bot.start({
  onStart: () => {
    logger.infoWithContext({ message: 'Copilot polling started' });
    stopReminders = startReminderLoop(bot);
  },
});
