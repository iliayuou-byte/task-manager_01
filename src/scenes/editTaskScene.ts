import { Composer, InlineKeyboard } from 'grammy';
import { generateAiTask } from '../clients/ai.js';
import { Command, EDITABLE_FIELDS } from '../core/config.js';
import logger from '../core/logger.js';
import type { EditableField, Priority, Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { taskFingerprint } from '../services/taskNumbers.js';
import {
  escapeMarkdownV2,
  findTaskIdxByName,
  findTimeConflictingTask,
  formatOperatedTaskStr,
  parseTags,
  promptCalendarAction,
} from '../utils/index.js';
import { FIELD_CONFIGS } from '../utils/validators.js';

const isValidField = (field: string): field is EditableField =>
  (EDITABLE_FIELDS as readonly string[]).includes(field);

const capitalize = (str: string) =>
  str.charAt(0).toUpperCase() + str.substring(1);

const isFieldEditable = (field: EditableField, task: Task): boolean => {
  if (field === 'time' || field === 'duration') {
    if (!task.date) return false;
  }
  if (field === 'duration') {
    if (!task.time) return false;
  }
  return true;
};

const generateEditKeyboard = (task: Task) => {
  const fields = Array.from(EDITABLE_FIELDS).filter((field) =>
    isFieldEditable(field, task),
  );
  const keyboard = new InlineKeyboard();

  for (let i = 0; i < fields.length; i += 2) {
    keyboard.text(capitalize(fields[i]), `edit_${fields[i]}`);
    if (i + 1 < fields.length) {
      keyboard.text(capitalize(fields[i + 1]), `edit_${fields[i + 1]}`);
    }
    keyboard.row();
  }

  // Add cancel to last row
  keyboard.text('❌ Cancel', 'edit_cancel');

  return keyboard;
};

export const editSceneComposer = new Composer<BotContext>();

export const enterEditScene = async (
  ctx: BotContext,
  taskIdx: number,
  expected?: Task,
) => {
  const { taskData } = await queryTasks();
  if (expected)
    taskIdx = taskData.uncompleted.findIndex(
      (task) => taskFingerprint(task) === taskFingerprint(expected),
    );
  const task = taskData.uncompleted[taskIdx];

  if (!task) {
    await ctx.reply('❌ Task not found.');
    return;
  }

  ctx.session.editScene = {
    active: true,
    taskIdx,
    fingerprint: taskFingerprint(task),
  };

  await ctx.reply(
    `Select a field to edit for *${escapeMarkdownV2(task.name)}*:`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: generateEditKeyboard(task),
    },
  );
};

// Action handler: User clicked a field button
editSceneComposer.callbackQuery(/^edit_(.+)$/, async (ctx) => {
  const state = ctx.session.editScene;
  if (!state?.active) return;

  const action = ctx.match[1];
  await ctx.answerCallbackQuery();

  if (action === 'cancel') {
    ctx.session.editScene = undefined;
    await ctx.editMessageText('❌ Edit cancelled.');
    return;
  }

  if (isValidField(action)) {
    state.field = action;
    await ctx.editMessageText(
      `✏️ Please enter the new value for *${escapeMarkdownV2(action)}*:`,
      { parse_mode: 'MarkdownV2' },
    );
  }
});

// Text handler: User typed the new value
editSceneComposer.on('message:text', async (ctx, next) => {
  const state = ctx.session.editScene;
  if (!state?.active) {
    return next();
  }

  if (!state.field) {
    return ctx.reply('⚠️ Please select a field first.');
  }

  const fieldToUpdate = state.field;
  const newValue = ctx.message.text;
  const userId = ctx.from.id;

  try {
    const { metadata, taskData } = await queryTasks();

    if (!metadata.timezone) {
      await ctx.reply(
        '❌ Timezone not set. Please set your timezone first using /settimezone command.',
      );
      ctx.session.editScene = undefined;
      return;
    }

    const taskIdx = state.fingerprint
      ? taskData.uncompleted.findIndex(
          (task) => taskFingerprint(task) === state.fingerprint,
        )
      : state.taskIdx;
    const oldTask = taskData.uncompleted[taskIdx];
    if (!oldTask) {
      await ctx.reply('❌ Task not found.');
      ctx.session.editScene = undefined;
      return;
    }

    let updatedTask = validateAndGetUpdatedTask(
      taskData.uncompleted,
      oldTask,
      fieldToUpdate,
      newValue,
    );

    if (!updatedTask) {
      await ctx.reply(
        `⚠️ The new value is the same as the current one for *${escapeMarkdownV2(
          fieldToUpdate,
        )}*\\. No changes made\\.`,
        { parse_mode: 'MarkdownV2' },
      );
      ctx.session.editScene = undefined;
      return;
    }

    if (fieldToUpdate === 'name') {
      const generatedTask = await generateAiTask(
        newValue,
        updatedTask.tags,
        metadata.timezone,
      );
      updatedTask = { ...updatedTask, ...generatedTask };
    }

    taskData.uncompleted[taskIdx] = updatedTask;
    await saveTasks(taskData, metadata);

    await ctx.reply(
      formatOperatedTaskStr(updatedTask, {
        command: Command.EDIT,
        prefix: `✅ *${escapeMarkdownV2(state.field)}* in `,
      }),
      { parse_mode: 'MarkdownV2' },
    );

    // Calendar Integration Logic
    if (oldTask.calendarEventId) {
      if (
        ['name', 'description', 'link', 'date', 'time', 'duration'].includes(
          fieldToUpdate,
        )
      ) {
        await promptCalendarAction(ctx, 'Update Google Calendar Event?', [
          {
            type: 'update',
            taskName: updatedTask.name,
            calendarEventId: oldTask.calendarEventId,
          },
        ]);
      }
    } else {
      if (
        ['date', 'time', 'duration'].includes(fieldToUpdate) &&
        updatedTask.date &&
        updatedTask.time
      ) {
        await promptCalendarAction(ctx, 'Add this task to Google Calendar?', [
          { type: 'add', taskName: updatedTask.name },
        ]);
      }
    }
  } catch (error) {
    await ctx.reply(
      `❌ Failed to update: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    logger.errorWithContext({ userId, op: Command.EDIT, error });
  }

  ctx.session.editScene = undefined;
});

// -- Helpers --

const validateAndGetUpdatedTask = (
  unCompletedTasks: Task[],
  task: Task,
  field: EditableField,
  value: string,
): Task | undefined => {
  const newTask = { ...task };
  const trimmedValue = value.trim();
  const config = FIELD_CONFIGS[field];

  const newValue = field === 'tags' ? undefined : trimmedValue;
  const newTags = field === 'tags' ? parseTags(trimmedValue) : [];

  // Validate tags format
  if (field === 'tags' && trimmedValue && !trimmedValue.includes('#')) {
    throw new Error('Tags must be prefixed with # (e.g., #work #sports)');
  }

  // Check for no-op (same value)
  let isSameValue = false;
  if (field === 'tags') {
    const existingTags = task.tags || [];
    isSameValue =
      existingTags.length === newTags.length &&
      existingTags.every((tag) => newTags.includes(tag));
  } else isSameValue = task[field] === (newValue || undefined);

  if (isSameValue) {
    return;
  }

  // Handle clearing the field (empty value)
  if (isEmptyValue(field === 'tags' ? newTags : newValue!)) {
    return clearField(newTask, field, config);
  }

  // Validate the new value
  if (!config.validator(field === 'tags' ? newTags : newValue)) {
    throw new Error(config.errorMessage);
  }

  // Constraint: Check name uniqueness
  if (
    field === 'name' &&
    findTaskIdxByName(unCompletedTasks, newValue!) !== -1
  ) {
    throw new Error('Task name must be unique');
  }

  // Constraint: Time conflict check
  if (field === 'time' || field === 'duration') {
    const simulatedTask = { ...newTask };
    if (field === 'time') {
      simulatedTask.time = newValue!;
      simulatedTask.duration = simulatedTask.duration || '1:00';
    }
    if (field === 'duration') {
      simulatedTask.duration = newValue!;
    }
    const conflictingTask = findTimeConflictingTask(
      simulatedTask,
      unCompletedTasks,
      task.name,
    );
    if (conflictingTask) {
      throw new Error(
        `Time conflict with existing task: "${conflictingTask.name}" (Date: ${conflictingTask.date}, Time: ${conflictingTask.time}, Duration: ${conflictingTask.duration})`,
      );
    }
  }

  // Assign the value
  if (field === 'tags') {
    newTask.tags = newTags;
  } else if (field === 'priority') {
    newTask.priority = value as Priority;
  } else {
    newTask[field] = value;
  }

  return newTask;
};

const isEmptyValue = (value: string | string[]): boolean => {
  if (typeof value === 'string') {
    return value.trim() === '';
  } else if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
};

const clearField = (
  task: Task,
  field: EditableField,
  config: (typeof FIELD_CONFIGS)[EditableField],
): Task => {
  if (field === 'name') {
    throw new Error('Task name cannot be empty');
  }

  if (field === 'tags') {
    task.tags = [];
    return task;
  }

  config.clearDependents?.forEach((dep) => {
    delete task[dep];
  });

  delete task[field];

  return task;
};
