import { formatInTimeZone } from 'date-fns-tz';
import type { Bot } from 'grammy';
import { ALLOWED_USERS } from '../core/config.js';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';
import { queryTasks } from './queryTasks.js';
import { saveTasks } from './saveTasks.js';
import { rememberTaskNumbers } from './taskNumbers.js';

export const parseReminderTimes = (input: string): string[] => {
  if (input === 'off') return [];
  const times = input.trim().split(/[\s,]+/);
  if (
    !times.length ||
    times.length > 4 ||
    times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
  ) {
    throw new Error('Use one to four times in HH:MM format');
  }
  return [...new Set(times)].sort();
};

export const dueReminderSlot = (
  times: readonly string[],
  now: Date,
  timezone: string,
  lastSent?: string,
): string | undefined => {
  const date = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const clock = formatInTimeZone(now, timezone, 'HH:mm');
  const minutes = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  // A ten-minute grace window covers brief restarts; don't send old reminders at night.
  return times
    .map((time) => `${date}T${time}`)
    .find(
      (slot) =>
        (!lastSent || slot > lastSent) &&
        minutes(clock) >= minutes(slot.slice(11)) &&
        minutes(clock) - minutes(slot.slice(11)) <= 10,
    );
};

let running = false;
export const checkReminders = async (
  bot: Bot<BotContext>,
  now = new Date(),
) => {
  if (running || !ALLOWED_USERS[0]) return;
  running = true;
  try {
    const { taskData, metadata } = await queryTasks();
    if (
      !metadata.timezone ||
      !metadata.reminder_times ||
      metadata.reminder_times === 'off'
    )
      return;
    const slot = dueReminderSlot(
      parseReminderTimes(metadata.reminder_times),
      now,
      metadata.timezone,
      metadata.reminder_last_sent,
    );
    if (!slot) return;
    const date = slot.slice(0, 10);
    const tasks = taskData.uncompleted.filter(
      (task) => !task.completed && (!task.date || task.date <= date),
    );
    const lines = tasks.length
      ? [
          `🔔 Напоминание · ${date}`,
          '',
          ...matrixLines(tasks),
          '/complete — отметить выполненное',
        ]
      : [
          '🔔 На сегодня незавершённых дел нет. Можно добавить через /brain или ГС.',
        ];
    for (const message of splitMessages(lines))
      await bot.api.sendMessage(ALLOWED_USERS[0], message);
    rememberTaskNumbers(ALLOWED_USERS[0], ALLOWED_USERS[0], tasks);
    // Re-read after network sends so task changes during delivery are preserved.
    const latest = await queryTasks();
    latest.metadata.reminder_last_sent = slot;
    await saveTasks(latest.taskData, latest.metadata);
  } catch {
    logger.warnWithContext({
      op: 'REMINDERS',
      message: 'Could not check or send reminders',
    });
  } finally {
    running = false;
  }
};

export const startReminderLoop = (bot: Bot<BotContext>): (() => void) => {
  void checkReminders(bot);
  const timer = setInterval(() => void checkReminders(bot), 60_000);
  return () => clearInterval(timer);
};
