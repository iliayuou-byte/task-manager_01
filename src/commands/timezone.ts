import { format, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { InlineKeyboard } from 'grammy';
import { COMMON_TIMEZONES, Command } from '../core/config.js';
import logger from '../core/logger.js';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { extractArg } from '../utils/index.js';
import { getNoTextMessage } from '../views/generalView.js';

export const myTimezoneCommand = async (ctx: BotContext) => {
  try {
    ctx.chatAction = 'typing';
    const { metadata } = await queryTasks();
    const timezone = metadata.timezone || 'Not set';
    ctx.reply(`🌍 Current timezone: *${timezone}*`, {
      parse_mode: 'Markdown',
    });
  } catch (error) {
    logger.errorWithContext({
      userId: ctx.from?.id,
      op: Command.MYTIMEZONE,
      error,
    });
    ctx.reply('❌ Failed to retrieve timezone.');
  }
};

export const setTimezoneCommand = async (ctx: BotContext) => {
  if (!ctx.message || !('text' in ctx.message)) {
    return ctx.reply(getNoTextMessage(Command.SETTIMEZONE));
  }

  const text = ctx.message.text!;
  const timezone = extractArg(text, Command.SETTIMEZONE);

  if (!timezone) {
    return ctx.reply('🌍 Select your timezone:', {
      reply_markup: generateTimezoneKeyboard(),
    });
  }

  await applyTimezone(ctx, timezone);
};

// --- Shared logic ---

export const applyTimezone = async (ctx: BotContext, timezone: string) => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    return ctx.reply('❌ Invalid timezone ID. Use /settimezone to pick one.');
  }

  try {
    const { taskData, metadata } = await queryTasks();
    const oldTimezone = metadata.timezone;

    if (oldTimezone === timezone) {
      return panelReply(ctx, `Timezone is already set to: ${timezone}`);
    }

    metadata.timezone = timezone;

    if (!oldTimezone) {
      await saveTasks(taskData, metadata);
      return panelReply(ctx, `✅ Timezone set to: *${timezone}*`, {
        parse_mode: 'Markdown',
      });
    }

    taskData.uncompleted = taskData.uncompleted.map((task: Task) => {
      if (task.date && task.time) {
        try {
          const dateTimeStr = `${task.date}T${task.time}:00`;
          const dateInUtc = fromZonedTime(dateTimeStr, oldTimezone);
          const dateInNewTz = toZonedTime(dateInUtc, timezone);
          const formatted = format(dateInNewTz, 'yyyy-MM-dd HH:mm', {
            timeZone: timezone,
          });
          [task.date, task.time] = formatted.split(' ');
        } catch (error) {
          logger.warnWithContext({
            userId: ctx.from?.id,
            op: Command.SETTIMEZONE,
            message: `Failed to convert timezone for task: ${task.name}`,
            error,
          });
        }
      }
      return task;
    });

    await saveTasks(taskData, metadata);

    await panelReply(
      ctx,
      `✅ Timezone updated to: *${timezone}*\n\nAll task dates and times have been converted to the new timezone.`,
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    logger.errorWithContext({
      userId: ctx.from?.id,
      op: Command.SETTIMEZONE,
      error,
    });
    await ctx.reply('❌ Failed to update timezone. Please try again.');
  }
};

// --- Keyboard ---

const generateTimezoneKeyboard = (): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  for (const tz of COMMON_TIMEZONES) {
    keyboard.text(tz.name, `tz_${tz.value}`).row();
  }
  keyboard.text('❌ Cancel', 'tz_cancel');
  return keyboard;
};
