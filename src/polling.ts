import bot from './bot.js';
import { COMMANDS } from './core/config.js';
import logger from './core/logger.js';

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
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
await bot.start({
  onStart: () => logger.infoWithContext({ message: 'Copilot polling started' }),
});
