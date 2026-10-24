import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { parseReminderTimes } from '../services/reminders.js';
import { saveTasks } from '../services/saveTasks.js';
import { extractArg, logAndReplyError } from '../utils/index.js';

export const remindersCommand = async (ctx: BotContext) => {
  try {
    const { taskData, metadata } = await queryTasks();
    const arg = extractArg(ctx.message?.text ?? '', Command.REMINDERS).trim();
    if (!arg)
      return await panelReply(
        ctx,
        `🔔 Напоминания: ${metadata.reminder_times || 'выключены'}\nЧасовой пояс: ${metadata.timezone || 'не задан'}\n\nВключить: /reminders 09:00 19:00\nВыключить: /reminders off\nПриходят списком дел на сегодня, пока бот запущен.`,
      );
    if (!metadata.timezone)
      return await panelReply(ctx, 'Сначала задай /settimezone Europe/Berlin');
    let times: string[];
    try {
      times = parseReminderTimes(arg);
    } catch {
      return await panelReply(
        ctx,
        'Укажи до четырёх времён: /reminders 09:00 19:00 либо /reminders off',
      );
    }
    if (times.length) metadata.reminder_saved_times = times.join(',');
    else if (metadata.reminder_times && metadata.reminder_times !== 'off')
      metadata.reminder_saved_times = metadata.reminder_times;
    metadata.reminder_times = times.length ? times.join(',') : 'off';
    await saveTasks(taskData, metadata);
    await panelReply(
      ctx,
      times.length
        ? `✅ Напоминания в ${times.join(', ')} (${metadata.timezone}).`
        : '🔕 Напоминания выключены.',
    );
  } catch (error) {
    logAndReplyError(ctx, Command.REMINDERS, error);
  }
};
