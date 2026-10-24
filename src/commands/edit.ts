import { generateTaskPickerKeyboard } from '../actions/taskPicker.js';
import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import {
  extractArg,
  findTaskIdxByName,
  logAndReplyError,
} from '../utils/index.js';
import {
  NO_TASK_MESSAGE,
  TASK_NOT_FOUND_MESSAGE,
} from '../views/generalView.js';

export const editCommand = async (
  ctx: BotContext,
  enterEditScene: (ctx: BotContext, taskIdx: number) => Promise<void>,
) => {
  if (!ctx.message || !('text' in ctx.message)) {
    return ctx.reply('❌ Please provide a task name to edit');
  }
  ctx.chatAction = 'typing';

  const text = ctx.message.text!;
  const arg = extractArg(text, Command.EDIT);

  if (!arg) {
    const { taskData } = await queryTasks();
    if (taskData.uncompleted.length === 0)
      return panelReply(ctx, NO_TASK_MESSAGE);
    return panelReply(ctx, 'Select a task to edit:', {
      reply_markup: generateTaskPickerKeyboard(
        taskData.uncompleted,
        'edit',
        'u',
        0,
      ),
    });
  }

  try {
    const { taskData } = await queryTasks();
    const taskIdx = findTaskIdxByName(taskData.uncompleted, arg);

    if (taskIdx === -1) {
      if (findTaskIdxByName(taskData.completed, arg) !== -1) {
        return ctx.reply(
          '⚠️ Task is completed. Please uncomplete it first to edit.',
        );
      }
      return ctx.reply(TASK_NOT_FOUND_MESSAGE);
    }

    await enterEditScene(ctx, taskIdx);
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.EDIT,
      error,
      '❌ Error initiating edit. Please try again.',
    );
  }
};
