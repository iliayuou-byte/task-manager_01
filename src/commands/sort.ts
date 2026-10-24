import { generateSortKeyboard } from '../actions/sort.js';
import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { logAndReplyError } from '../utils/index.js';

export const sortCommand = async (ctx: BotContext) => {
  try {
    ctx.chatAction = 'typing';
    const { taskData } = await queryTasks();

    if (taskData.uncompleted.length === 0) {
      return panelReply(ctx, '📭 No tasks to sort.');
    }

    await panelReply(
      ctx,
      '🔀 *Sort Tasks*\n\nChoose how to sort your uncompleted tasks:',
      {
        parse_mode: 'MarkdownV2',
        reply_markup: generateSortKeyboard(),
      },
    );
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.SORT,
      error,
      '❌ Error loading tasks. Please try again.',
    );
  }
};
