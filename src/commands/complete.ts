import { InlineKeyboard } from 'grammy';
import { showCompletePicker } from '../actions/taskPicker.js';
import { Command } from '../core/config.js';
import type { BotContext } from '../middlewares/session.js';
import { panelNotice, panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import {
  extractArg,
  findTaskIdxByName,
  logAndReplyError,
  markTaskCompleted,
} from '../utils/index.js';
import {
  getNoTextMessage,
  NO_TASK_MESSAGE,
  TASK_NOT_FOUND_MESSAGE,
} from '../views/generalView.js';

export const completeCommand = async (ctx: BotContext) => {
  try {
    ctx.chatAction = 'typing';
    if (!ctx.message || !('text' in ctx.message)) {
      return panelReply(ctx, getNoTextMessage(Command.COMPLETE));
    }

    const text = ctx.message.text!;
    const arg = extractArg(text, Command.COMPLETE);

    if (!arg) {
      const { taskData } = await queryTasks();
      if (taskData.uncompleted.length === 0)
        return panelReply(ctx, NO_TASK_MESSAGE);
      return showCompletePicker(ctx, taskData.uncompleted);
    }

    const { taskData, metadata } = await queryTasks();
    const taskIdx = findTaskIdxByName(taskData.uncompleted, arg);
    if (taskIdx === -1) {
      return panelReply(ctx, TASK_NOT_FOUND_MESSAGE);
    }

    markTaskCompleted(taskData.uncompleted[taskIdx], metadata.timezone);
    const task = taskData.uncompleted.splice(taskIdx, 1)[0];
    taskData.completed.unshift(task);
    if (!(await saveTasks(taskData, metadata)))
      throw new Error('Storage did not confirm save');

    await showCompletePicker(ctx, taskData.uncompleted);
    await panelNotice(ctx, `✅ Выполнено: ${task.name}`, {
      reply_markup: new InlineKeyboard().text('⬅️ Назад', 'menu:home'),
    });
  } catch (error) {
    await logAndReplyError(
      ctx,
      Command.COMPLETE,
      error,
      '❌ Error completing task. Please try again.',
    );
  }
};
