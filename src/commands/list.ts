import { Command } from '../core/config.js';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { rememberTaskNumbers } from '../services/taskNumbers.js';
import { extractArg, logAndReplyError, parseTags } from '../utils/index.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';
import { NO_TASK_MESSAGE } from '../views/generalView.js';

export const listCommand = async (ctx: BotContext) => {
  try {
    ctx.chatAction = 'typing';
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text! : '';
    const arg = extractArg(text, Command.LIST).trim();

    const { taskData } = await queryTasks();

    let tasksToDisplay: Task[];
    let title: string;

    if (!arg) {
      // Default: show pending tasks
      tasksToDisplay = taskData.uncompleted;
      title = '📚 Твои дела';
    } else if (arg.toLowerCase() === 'all') {
      // Show all tasks
      tasksToDisplay = taskData.uncompleted.concat(taskData.completed);
      title = '📚 Все дела · включая выполненные';
    } else {
      // Filter by tags
      const filterTags = parseTags(arg);
      if (filterTags.length === 0) {
        return panelReply(
          ctx,
          '❌ Invalid filter. Use /list, /list all, or /list #tag',
        );
      }

      tasksToDisplay = taskData.uncompleted.filter((task) =>
        filterTags.every((filterTag) =>
          task.tags.some((taskTag) => taskTag.toLowerCase() === filterTag),
        ),
      );

      const tagStr = filterTags.map((t) => `#${t}`).join(' ');
      title = `🏷 Дела с тегами ${tagStr}`;
    }

    if (tasksToDisplay.length === 0) {
      return panelReply(ctx, NO_TASK_MESSAGE);
    }

    for (const message of splitMessages([
      title.replace(/\*/g, ''),
      '',
      ...matrixLines(tasksToDisplay),
    ])) {
      await panelReply(ctx, message);
    }
    if (ctx.from && ctx.chat)
      rememberTaskNumbers(ctx.from.id, ctx.chat.id, tasksToDisplay);
  } catch (error) {
    logAndReplyError(ctx, Command.LIST, error, '❌ Error fetching tasks.');
  }
};
