import type { Bot } from 'grammy';
import type { Context } from 'hono';
import type { BotContext } from '../middlewares/session.js';
import { checkReminders } from '../services/reminders.js';

export const cronHandler = async (c: Context, bot: Bot<BotContext>) => {
  await checkReminders(bot);
  return c.json(
    { success: true, message: 'Configured reminders checked' },
    200,
  );
};
