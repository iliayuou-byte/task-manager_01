import { generateRemovePickerKeyboard } from '../actions/taskPicker.js';
import { Command } from '../core/config.js';
import logger from '../core/logger.js';
import type { TaskTypeToOp } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelNotice, panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import {
  extractArg,
  findTaskIdxByName,
  formatOperatedTaskStr,
  logAndReplyError,
  promptCalendarAction,
} from '../utils/index.js';
import {
  NO_TASK_MESSAGE,
  TASK_NOT_FOUND_MESSAGE,
} from '../views/generalView.js';
import { removeByNumbers } from './removeSelected.js';

export const removeCommand = async (ctx: BotContext) => {
  if (!ctx.message || !('text' in ctx.message)) {
    return panelReply(ctx, '❌ Please provide a task name to remove');
  }

  try {
    ctx.chatAction = 'typing';
    const text = ctx.message.text!;
    const arg = extractArg(text, Command.REMOVE);

    if (/^\d+(?:[\s,]+\d+)*$/.test(arg.trim()))
      return await removeByNumbers(ctx, arg.trim());

    if (!arg) {
      const { taskData } = await queryTasks();
      const total = taskData.uncompleted.length + taskData.completed.length;
      if (total === 0) return panelReply(ctx, NO_TASK_MESSAGE);
      return panelReply(ctx, 'Select a task to remove:', {
        reply_markup: generateRemovePickerKeyboard(taskData, 0),
      });
    }

    const { taskData, metadata } = await queryTasks();

    let taskIdx = findTaskIdxByName(taskData.uncompleted, arg);
    let taskTypeToRemove: TaskTypeToOp = 'none';
    if (taskIdx === -1) {
      taskIdx = findTaskIdxByName(taskData.completed, arg);
      if (taskIdx === -1) {
        return panelReply(ctx, TASK_NOT_FOUND_MESSAGE);
      }
      taskTypeToRemove = 'completed';
    } else {
      taskTypeToRemove = 'uncompleted';
    }

    const taskToRemove =
      taskTypeToRemove === 'uncompleted'
        ? taskData.uncompleted[taskIdx]
        : taskData.completed[taskIdx];

    logger.infoWithContext({
      userId: ctx.from?.id,
      op: Command.REMOVE,
      message: `Attempting to remove task from ${taskTypeToRemove} tasks: ${taskToRemove?.name}`,
    });

    const calendarEventId = taskToRemove.calendarEventId;

    // Then remove from task table
    taskData[taskTypeToRemove].splice(taskIdx, 1);
    if (!(await saveTasks(taskData, metadata)))
      throw new Error('Storage did not confirm save');

    const { returnToTaskList } = await import('./menu.js');
    await returnToTaskList(ctx);
    await panelNotice(
      ctx,
      formatOperatedTaskStr(taskToRemove, {
        command: Command.REMOVE,
        prefix: '🗑️ ',
      }),
      { parse_mode: 'MarkdownV2' },
    );

    if (calendarEventId) {
      await promptCalendarAction(
        ctx,
        'Remove corresponding Google Calendar Event?',
        [{ type: 'remove', taskName: taskToRemove.name, calendarEventId }],
        true,
      );
    }
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.REMOVE,
      error,
      '❌ Error removing task. Please try again.',
    );
  }
};
