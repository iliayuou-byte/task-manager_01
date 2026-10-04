import { formatInTimeZone } from 'date-fns-tz';
import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { queryTasks } from '../services/queryTasks.js';
import { rememberTaskNumbers } from '../services/taskNumbers.js';
import { logAndReplyError } from '../utils/index.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';

export const todayCommand = async (ctx: BotContext) => {
  try {
    ctx.chatAction = 'typing';
    const { taskData, metadata } = await queryTasks();

    if (!metadata.timezone) {
      return ctx.reply(
        '❌ Timezone not set. Please set your timezone first using /settimezone command.',
      );
    }

    const today = new Date();
    const date = formatInTimeZone(today, metadata.timezone, 'yyyy-MM-dd');
    const todaysTasks = taskData.uncompleted.filter(
      (task) => !task.date || task.date <= date,
    );

    if (todaysTasks.length === 0) {
      return ctx.reply('📭 No tasks for today!');
    }

    for (const message of splitMessages([
      `📋 Сегодня · ${date}`,
      '',
      ...matrixLines(todaysTasks),
    ])) {
      await ctx.reply(message);
    }
    if (ctx.from && ctx.chat)
      rememberTaskNumbers(ctx.from.id, ctx.chat.id, todaysTasks);
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.TODAY,
      error,
      "❌ Failed to get today's tasks.",
    );
  }
};
