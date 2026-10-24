import type { Bot } from 'grammy';
import type { Context } from 'hono';
import { ALLOWED_USERS } from '../core/config.js';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import { checkPersonalReminders } from '../services/personalNotifications.js';
import { personalEnabled } from '../services/personalStore.js';
import { queryTasks } from '../services/queryTasks.js';
import { getTasksByDay } from '../utils/index.js';
import { getTodaysTasksMessage } from '../views/generalView.js';

export const cronHandler = async (c: Context, bot: Bot<BotContext>) => {
  if (personalEnabled()) {
    const sent = await checkPersonalReminders((id, text) =>
      bot.api.sendMessage(id, text),
    );
    return c.json({ success: true, sent });
  }
  const { taskData, metadata } = await queryTasks();

  if (!metadata.timezone) {
    logger.warnWithContext({
      message: 'Timezone not set - skipping notification',
    });
    return c.json({ success: true, message: 'Timezone not set' }, 200);
  }

  const now = new Date();
  const dailyTasks = getTasksByDay(
    taskData.uncompleted,
    now,
    metadata.timezone,
  );

  if (dailyTasks.length === 0) {
    logger.infoWithContext({
      message: 'No tasks for today, skipping notification',
    });
    return c.json({ success: true, message: 'No tasks for today' }, 200);
  }

  const message = getTodaysTasksMessage(
    dailyTasks,
    metadata.timezone,
    '🔔',
    'Daily Reminder',
  );

  await bot.api.sendMessage(ALLOWED_USERS[0], message, {
    parse_mode: 'MarkdownV2',
  });

  return c.json({ success: true, notified: ALLOWED_USERS[0] }, 200);
};
