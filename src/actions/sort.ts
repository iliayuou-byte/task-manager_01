import { type Composer, InlineKeyboard } from 'grammy';
import { Command } from '../core/config.js';
import logger from '../core/logger.js';
import { Priority, type Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';

enum SortType {
  PRIORITY = 'priority',
  TIME = 'time',
}

const PRIORITY_ORDER: Record<Priority, number> = {
  [Priority.URGENT]: 0,
  [Priority.HIGH]: 1,
  [Priority.MEDIUM]: 2,
  [Priority.LOW]: 3,
};

const sortByPriority = (tasks: Task[]): Task[] => {
  return [...tasks].sort((a, b) => {
    const priorityA = a.priority ? PRIORITY_ORDER[a.priority] : 4;
    const priorityB = b.priority ? PRIORITY_ORDER[b.priority] : 4;
    return priorityA - priorityB;
  });
};

const sortByTime = (tasks: Task[]): Task[] => {
  return [...tasks].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;

    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    if (!a.time && !b.time) return 0;
    if (!a.time) return 1;
    if (!b.time) return -1;

    return a.time.localeCompare(b.time);
  });
};

export const generateSortKeyboard = () =>
  new InlineKeyboard()
    .text('🔥 By Priority', `sort_${SortType.PRIORITY}`)
    .text('🕐 By Time', `sort_${SortType.TIME}`)
    .row()
    .text('❌ Cancel', 'sort_cancel');

export const registerSortAction = (composer: Composer<BotContext>) => {
  composer.callbackQuery(/^sort_(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const userId = ctx.from!.id;

    await ctx.answerCallbackQuery();

    if (action === 'cancel') {
      await panelReply(ctx, '❌ Sort cancelled.');
      return;
    }

    try {
      const { metadata, taskData } = await queryTasks();

      let sortedTasks: Task[];
      let sortLabel: string;

      if (action === SortType.PRIORITY) {
        sortedTasks = sortByPriority(taskData.uncompleted);
        sortLabel = 'priority';
      } else if (action === SortType.TIME) {
        sortedTasks = sortByTime(taskData.uncompleted);
        sortLabel = 'time';
      } else {
        return;
      }

      taskData.uncompleted = sortedTasks;
      await saveTasks(taskData, metadata);

      await panelReply(
        ctx,
        `✅ Tasks sorted by ${sortLabel}. (${sortedTasks.length} tasks)`,
      );
    } catch (error) {
      await panelReply(ctx, '❌ Failed to sort tasks. Please try again.');
      logger.errorWithContext({ userId, op: Command.SORT, error });
    }
  });
};
