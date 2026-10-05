import { format } from 'date-fns-tz';
import { InlineKeyboard } from 'grammy';
import { Command } from '../core/config.js';
import logger from '../core/logger.js';
import type { CalendarOpSession, Task } from '../core/types.js';
import {
  type BotContext,
  setPendingCalendarOps,
} from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import { navigationKeyboard } from '../views/menuView.js';

// Extract argument from command text
export const extractArg = (text: string, command: string) =>
  text.substring(command.length + 1).trim();

/**
 * Parse tags from text input to array
 * - Only handles tags with '#' prefix
 * - Extracts #-prefixed words and converts them to lowercase
 * - Removes duplicates and empty values
 *
 * Examples:
 *   - "#tag1 #tag2" → ["tag1", "tag2"]
 *   - "#tag1#tag2" → ["tag1", "tag2"]
 *   - "#tag1,#tag2" → ["tag1", "tag2"]
 *   - "#tag1 text #tag2" → ["tag1", "tag2"] (ignores "text")
 *   - "hi #1 #2" → ["1", "2"] (ignores "hi")
 */
export const parseTags = (input: string | undefined): string[] => {
  if (!input || input.trim() === '') return [];

  const tagMatches = input.match(/#\w+/g) || [];

  return Array.from(
    new Set(
      tagMatches
        .map((tag) => tag.slice(1).toLowerCase()) // Remove # prefix and lowercase
        .filter((tag) => tag.length > 0),
    ),
  );
};
export const formatTags = (tags: string[]): string =>
  tags.map((tag) => `#${escapeMarkdownV2(tag)}`).join(' ');

/**
 * Escapes special characters for Telegram MarkdownV2 format
 * Reference: https://core.telegram.org/bots/api#markdownv2-style
 */
const SPECIAL_CHARS = /([_*[\]()~`>#+\-=|{}.!\\])/g;
export const escapeMarkdownV2 = (text: string): string =>
  text.replace(SPECIAL_CHARS, '\\$1');

/**
 * Escapes characters that would break a Markdown table cell
 */
export const escapeMarkdownTable = (text: string | undefined): string => {
  if (!text) return '';
  return text.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
};

const parseDateTime = (dateStr: string, timeStr: string): Date => {
  return new Date(`${dateStr}T${timeStr}`);
};

export const addMinutes = (date: Date, minutes: number): Date => {
  return new Date(date.getTime() + minutes * 60000);
};

export const parseDurationInMinutes = (durationStr: string): number => {
  const [hours, minutes] = durationStr.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

export const formatTimeRange = (
  timeStr: string,
  durationStr: string,
): string => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const totalMinutes = (hours || 0) * 60 + (minutes || 0);
  const durationMinutes = parseDurationInMinutes(durationStr);
  const endTotalMinutes = totalMinutes + durationMinutes;

  const endHours = Math.floor(endTotalMinutes / 60) % 24;
  const endMinutes = endTotalMinutes % 60;

  return `${timeStr} - ${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
};

export const formatOperatedTaskStr = (
  task: Task,
  {
    command,
    prefix,
    suffix,
  }: { command: Command; prefix?: string; suffix?: string },
): string => {
  const escapedName = escapeMarkdownV2(task.name);
  const escapedDesc = task.description
    ? escapeMarkdownV2(task.description)
    : '';
  const escapedDate = task.date ? escapeMarkdownV2(task.date) : '';
  const timeRange =
    task.date && task.time && task.duration
      ? escapeMarkdownV2(formatTimeRange(task.time, task.duration))
      : '';
  const escapedTags =
    task.tags.map((t) => `\\#${escapeMarkdownV2(t)}`).join(' ') || '';
  // title line
  let response = `${prefix || ''}*Task ${command}${command === Command.ADD || command === Command.EDIT ? 'ed' : 'd'}*\n\n`;
  response += `*Task:* ${escapedName}\n`;
  if (escapedDesc) response += `*Description:* ${escapedDesc}\n`;
  if (escapedDate)
    response += `*Time:* ${escapedDate}${timeRange ? ` \\(${timeRange}\\)` : ''}\n`;
  if (escapedTags) response += `*Tags:* ${escapedTags}\n`;
  if (task.link) {
    const escapedUrl = task.link.replace(/([)\\])/g, '\\$1');
    const escapedLinkText = escapeMarkdownV2(task.link);
    response += `*Link:* [${escapedLinkText}](${escapedUrl})\n`;
  }

  // Add suffix at the end if provided
  if (suffix) {
    response += suffix;
  }

  return response;
};
const formatTaskItemStr = (task: Task, showStatus = false): string => {
  const escapedName = escapeMarkdownV2(task.name);
  const status = showStatus ? (task.completed ? '✅ ' : '⚪ ') : '';
  const calendarIcon = task.calendarEventId ? '🗓️ ' : '';
  const date = task.date ? ` \\(${escapeMarkdownV2(task.date)}\\)` : '';
  const timeRange =
    task.date && task.time && task.duration
      ? ` \\[${escapeMarkdownV2(formatTimeRange(task.time, task.duration))}\\]`
      : '';
  const tags =
    task.tags.length > 0
      ? ` ${task.tags.map((t) => `\\#${escapeMarkdownV2(t)}`).join(' ')}`
      : '';

  let line = `${status}${calendarIcon}*${escapedName}*${date}${timeRange}${tags}`;

  if (task.description) {
    line += `\n> _${escapeMarkdownV2(task.description)}_`;
  }

  if (task.link) {
    const escapedUrl = task.link.replace(/([)\\])/g, '\\$1');
    const escapedLinkText = escapeMarkdownV2(task.link);
    line += `\n 🔗 [${escapedLinkText}](${escapedUrl})`;
  }

  return line;
};

export const formatTaskListStr = (
  tasks: readonly Task[],
  showStatus = false,
): string => {
  return tasks
    .map((task, index) => {
      return `${index + 1}\\. ${formatTaskItemStr(task, showStatus)}`;
    })
    .join('\n\n');
};

// Time conflict checking
export const findTimeConflictingTask = (
  newTask: Task,
  tasks: Task[],
  excludeTaskName?: string,
): Task | undefined => {
  if (!newTask.date || !newTask.time || !newTask.duration) {
    return undefined;
  }
  const newTaskStart = parseDateTime(newTask.date, newTask.time);
  const newTaskDuration = parseDurationInMinutes(newTask.duration);
  const newTaskEnd = addMinutes(newTaskStart, newTaskDuration);

  return tasks.find((t) => {
    // Check if task has necessary time info
    if (!t.date || !t.time || !t.duration) return false;

    // Skip if it's the task we want to exclude (e.g., when editing)
    if (excludeTaskName && t.name === excludeTaskName) return false;

    // Check if it's the same day
    if (t.date !== newTask.date) return false;

    const tStart = parseDateTime(t.date, t.time);
    const tDuration = parseDurationInMinutes(t.duration);
    const tEnd = addMinutes(tStart, tDuration);

    // Check for overlap: (StartA < EndB) && (EndA > StartB)
    return newTaskStart < tEnd && newTaskEnd > tStart;
  });
};

// Extract tags from user text while preserving main text
export const parseUserText = (
  text: string,
): { tags: string[]; text: string } => {
  // Extract tags only from #-prefixed words
  const tags = parseTags(text);

  // Remove only the #tags, keep everything else
  const cleanedText = text
    .replace(/#\w+/g, '') // Remove all #word patterns
    .replace(/\s+/g, ' ') // Normalize multiple spaces
    .trim();

  return { tags, text: cleanedText };
};

export const getTasksByDay = (
  tasks: Task[],
  now: Date,
  timezone: string,
): Task[] => {
  const today = format(now, 'yyyy-MM-dd', { timeZone: timezone });

  const pendingTasks: Task[] = [];
  const allDayEvents: Task[] = [];
  const events: Task[] = [];
  for (const task of tasks) {
    if (task.completed) continue;
    if (!task.date) {
      pendingTasks.push(task);
    } else {
      if (task.date === today) {
        if (!task.time) {
          allDayEvents.push(task);
        } else {
          events.push(task);
        }
      }
    }
  }

  const tasksByDay = [
    ...pendingTasks,
    ...allDayEvents,
    ...events.sort((a, b) => {
      if (a.time && b.time) {
        return a.time.localeCompare(b.time);
      }
      return 0;
    }),
  ];

  return tasksByDay;
};

export const findTaskIdxByName = (
  tasks: readonly Task[],
  name: string,
): number => tasks.findIndex((task) => task.name === name);

export const markTaskCompleted = (task: Task, timezone?: string) => {
  task.completed = true;
  const now = new Date();
  const completedAt = format(now, 'yyyy-MM-dd HH:mm:ss', {
    timeZone: timezone,
  });
  task.log = `Completed ${completedAt} (${timezone})`;
};

const calendarKeyboard = new InlineKeyboard()
  .text('Yes', 'cal_yes')
  .text('No', 'cal_no')
  .row()
  .text('⬅️ Назад', 'cal_no')
  .text('🏠 Меню', 'menu:home');

export const promptCalendarAction = async (
  ctx: BotContext,
  message: string,
  ops: CalendarOpSession[],
) => {
  setPendingCalendarOps(ctx.from!.id, ops);
  await panelReply(ctx, message, { reply_markup: calendarKeyboard });
};

export const logAndReplyError = (
  ctx: BotContext,
  op: string,
  error: unknown,
  message = '❌ Something went wrong. Please try again.',
) => {
  logger.errorWithContext({ userId: ctx.from?.id, op, error });
  panelReply(ctx, message, {
    reply_markup:
      ctx.chat?.type === 'private' ? navigationKeyboard() : undefined,
  });
};
