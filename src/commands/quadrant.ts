import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { setQuadrant } from '../services/eisenhower.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { extractArg, logAndReplyError } from '../utils/index.js';

export const quadrantCommand = async (ctx: BotContext) => {
  try {
    const match = extractArg(ctx.message?.text ?? '', Command.QUADRANT)
      .trim()
      .match(/^([1-4])\s+(.+)$/);
    if (!match)
      return await ctx.reply(
        '/quadrant 1 название задачи\n1 — важно и срочно\n2 — важно, не срочно\n3 — не важно, срочно\n4 — не важно, не срочно',
      );
    const { taskData, metadata } = await queryTasks();
    const index = taskData.uncompleted.findIndex(
      (task) => task.name.toLowerCase() === match[2].trim().toLowerCase(),
    );
    if (index < 0)
      return await ctx.reply('Не нашёл задачу. Скопируй её название из /list.');
    taskData.uncompleted[index] = setQuadrant(
      taskData.uncompleted[index],
      Number(match[1]),
    );
    await saveTasks(taskData, metadata);
    await ctx.reply(
      `✅ Раздел ${match[1]}: ${taskData.uncompleted[index].name}`,
    );
  } catch (error) {
    logAndReplyError(ctx, Command.QUADRANT, error);
  }
};
