import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { rankTasks } from '../services/priorityEngine.js';
import { queryTasks } from '../services/queryTasks.js';
import { extractArg, logAndReplyError } from '../utils/index.js';
import { getCopilotMessage } from '../views/copilotView.js';

export const nowCommand = async (ctx: BotContext) => {
  try {
    ctx.chatAction = 'typing';
    const arg = extractArg(ctx.message?.text ?? '', Command.NOW).trim();
    if (arg && (!/^\d+$/.test(arg) || Number(arg) < 1 || Number(arg) > 1440)) {
      return await ctx.reply(
        'Используй /now или /now 30 — доступные минуты от 1 до 1440.',
      );
    }
    const { taskData, metadata } = await queryTasks();
    if (!metadata.timezone) {
      return await ctx.reply(
        'Сначала задай часовой пояс: /settimezone Europe/Berlin',
      );
    }
    const ranked = rankTasks(
      taskData.uncompleted,
      new Date(),
      metadata.timezone,
      arg ? Number(arg) : undefined,
    );
    return await ctx.reply(getCopilotMessage(ranked));
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.NOW,
      error,
      '❌ Не удалось выбрать задачу. Попробуй ещё раз.',
    );
  }
};
