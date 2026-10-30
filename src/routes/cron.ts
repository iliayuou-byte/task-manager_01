import type { Bot } from 'grammy';
import type { Context } from 'hono';
import type { BotContext } from '../middlewares/session.js';
import { checkPersonalReminders } from '../services/personalNotifications.js';
import { checkReminders } from '../services/reminders.js';

export const cronHandler = async (c: Context, bot: Bot<BotContext>) => {
  await checkReminders(bot);
  const personalSent = await checkPersonalReminders((id, text, options) =>
    bot.api.sendMessage(id, text, options),
  );
  return c.json({
    success: true,
    personalSent,
    message: 'Configured reminders checked',
  });
};
