import { Composer, InlineKeyboard } from 'grammy';
import { generateAiTask } from '../clients/ai.js';
import { Command } from '../core/config.js';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import {
  extractArg,
  findTaskIdxByName,
  findTimeConflictingTask,
  formatOperatedTaskStr,
  formatTimeRange,
  logAndReplyError,
  parseUserText,
  promptCalendarAction,
} from '../utils/index.js';
import { getNoTextMessage } from '../views/generalView.js';

export const addCommand = async (ctx: BotContext) => {
  if (!ctx.message || !('text' in ctx.message)) {
    return panelReply(ctx, getNoTextMessage(Command.ADD));
  }
  ctx.chatAction = 'typing';

  const text = ctx.message.text!;
  const arg = extractArg(text, Command.ADD);

  if (!arg) {
    ctx.session.awaitingAdd = true;
    return panelReply(
      ctx,
      '📝 What task would you like to add?\n\n_e.g. "Buy groceries tomorrow at 15:00 #shopping"_',
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('⬅️ Назад', 'add_cancel'),
      },
    );
  }

  await processAdd(ctx, arg);
};

// Composer to handle the follow-up text message
export const addSceneComposer = new Composer<BotContext>();

addSceneComposer.callbackQuery('add_cancel', async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.awaitingAdd = undefined;
  const { menuCommand } = await import('./menu.js');
  await menuCommand(ctx);
});

addSceneComposer.on('message:text', async (ctx, next) => {
  if (!ctx.session.awaitingAdd) return next();

  ctx.session.awaitingAdd = undefined;
  await processAdd(ctx, ctx.message.text);
});

// --- Core add logic ---

const processAdd = async (ctx: BotContext, input: string) => {
  try {
    const { metadata, taskData } = await queryTasks();

    if (!metadata.timezone) {
      return panelReply(
        ctx,
        '❌ Timezone not set. Please set your timezone first using /settimezone command.',
      );
    }

    let task: Task;
    try {
      task = await processNewTask(input, metadata.timezone, metadata);
    } catch (error) {
      return panelReply(
        ctx,
        `❌ ${error instanceof Error ? error.message : 'Failed to add task due to an unknown error.'}`,
      );
    }

    const timeConflictingTask = findTimeConflictingTask(
      task,
      taskData.uncompleted,
    );

    if (timeConflictingTask) {
      return panelReply(
        ctx,
        `❌ Time conflict with existing task: "${timeConflictingTask.name}" (Date: ${timeConflictingTask.date}, Time: ${formatTimeRange(timeConflictingTask.time!, timeConflictingTask.duration!)})`,
      );
    }

    task.name = getUniqueTaskName(task.name, taskData.uncompleted);
    taskData.uncompleted.unshift(task);
    await saveTasks(taskData, metadata);

    const response = formatOperatedTaskStr(task, {
      command: Command.ADD,
      prefix: '✅ ',
    });

    await panelReply(ctx, response, { parse_mode: 'MarkdownV2' });

    if (task.date && task.time) {
      await promptCalendarAction(ctx, 'Add this task to Google Calendar?', [
        { type: 'add', taskName: task.name },
      ]);
    }
  } catch (error) {
    logAndReplyError(
      ctx,
      Command.ADD,
      error,
      '❌ Error adding task. Please try again.',
    );
  }
};

// --- Helpers ---

const getUniqueTaskName = (taskName: string, tasks: Task[]): string => {
  let uniqueName = taskName;

  if (findTaskIdxByName(tasks, uniqueName) === -1) {
    return uniqueName;
  }

  const match = taskName.match(/^(.+?)\s*\((\d+)\)$/);

  if (match) {
    const baseName = match[1];
    let counter = parseInt(match[2], 10);
    do {
      counter++;
      uniqueName = `${baseName} (${counter})`;
    } while (findTaskIdxByName(tasks, uniqueName) !== -1);
  } else {
    let counter = 1;
    do {
      uniqueName = `${taskName} (${counter})`;
      counter++;
    } while (findTaskIdxByName(tasks, uniqueName) !== -1);
  }

  return uniqueName;
};

const processNewTask = async (
  userText: string,
  timezone: string,
  preferences: import('../core/types.js').Metadata,
): Promise<Task> => {
  const { tags, text } = parseUserText(userText);
  const task = await generateAiTask(text, tags, timezone, preferences);
  return {
    completed: false,
    ...task,
    tags: [...new Set([...tags, ...task.tags])],
  };
};
