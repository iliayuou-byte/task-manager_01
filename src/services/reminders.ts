import { formatInTimeZone } from 'date-fns-tz';
import { type Bot, InlineKeyboard } from 'grammy';
import logger from '../core/logger.js';
import type { BotContext } from '../middlewares/session.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';
import { parseFireTvMedia, wakeFireTv } from './fireTv.js';
import {
  morningExpiry,
  morningItems,
  morningKeyboard,
  morningText,
} from './morningChecklist.js';
import { queryTasks } from './queryTasks.js';
import { saveTasks } from './saveTasks.js';
import { rememberTaskNumbers } from './taskNumbers.js';
import { pruneUsageStats } from './usageStats.js';
import { profileUsers, runForUser } from './userScope.js';

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

const checkUserReminders = async (
  bot: Bot<BotContext>,
  userId: number,
  now: Date,
) => {
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
    await bot.api.sendMessage(userId, message);
  rememberTaskNumbers(userId, userId, tasks);
  // Re-read after network sends so task changes during delivery are preserved.
  const latest = await queryTasks();
  latest.metadata.reminder_last_sent = slot;
  await saveTasks(latest.taskData, latest.metadata);
};

const dateOffset = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const mostRecentFriday = (date: string, weekday: number) =>
  dateOffset(
    date,
    weekday === 6
      ? -1
      : weekday === 7
        ? -2
        : weekday === 5
          ? 0
          : -((weekday + 2) % 7),
  );

const isDue = (clock: string, target: string) => {
  const minute = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return (
    minute(clock) >= minute(target) && minute(clock) - minute(target) <= 10
  );
};

const checkUserWakeSchedule = async (
  bot: Bot<BotContext>,
  userId: number,
  now: Date,
) => {
  const { metadata } = await queryTasks();
  if (
    metadata.morning_message_id &&
    (metadata.morning_enabled === 'false' ||
      (metadata.morning_expires_at &&
        now.getTime() >= Date.parse(metadata.morning_expires_at)))
  ) {
    try {
      await bot.api.deleteMessage(userId, Number(metadata.morning_message_id));
    } catch (error) {
      logger.warnWithContext({
        userId,
        op: 'MORNING_CLEANUP',
        error: error instanceof Error ? error.message : String(error),
      });
      const permanentFailure =
        typeof error === 'object' &&
        error !== null &&
        'error_code' in error &&
        error.error_code === 400;
      // A stopped server may resume after Telegram's deletion window.
      const longExpired =
        !!metadata.morning_expires_at &&
        now.getTime() - Date.parse(metadata.morning_expires_at) >=
          48 * 60 * 60_000;
      if (!permanentFailure && !longExpired) return;
    }
    const latest = await queryTasks();
    if (latest.metadata.morning_message_id === metadata.morning_message_id) {
      delete latest.metadata.morning_message_id;
      delete latest.metadata.morning_active_date;
      delete latest.metadata.morning_active_items;
      delete latest.metadata.morning_done;
      delete latest.metadata.morning_expires_at;
      delete latest.metadata.morning_wake_time;
      delete latest.metadata.morning_note;
      if (!(await saveTasks(latest.taskData, latest.metadata)))
        throw new Error('Morning cleanup was not saved');
    }
  }
  const timezone = metadata.timezone;
  if (!timezone) return;

  const date = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const clock = formatInTimeZone(now, timezone, 'HH:mm');
  const weekday = Number(formatInTimeZone(now, timezone, 'i'));

  if (
    weekday === 5 &&
    metadata.wake_friday_prompt_sent !== date &&
    isDue(clock, metadata.wake_friday_prompt_time || '21:00')
  ) {
    await bot.api.sendMessage(
      userId,
      'Пятница на связи. Сегодня планируется алкоголь? От этого выберу время подъёма на выходных.',
      {
        reply_markup: new InlineKeyboard()
          .text('🍻 Да, буду', 'wake:yes')
          .text('🌿 Нет', 'wake:no'),
      },
    );
    const latest = await queryTasks();
    latest.metadata.wake_friday_prompt_sent = date;
    if (!(await saveTasks(latest.taskData, latest.metadata)))
      throw new Error('Friday prompt was not saved');
  }

  const weekdayWakeTime = metadata.wake_weekday_time || '08:00';
  const soberWakeTime = metadata.wake_weekend_sober_time || '09:00';
  const drinkingWakeTime = metadata.wake_weekend_drinking_time || '10:00';
  const weekendFriday = mostRecentFriday(date, weekday);
  const weekendMode =
    metadata.wake_weekend_mode_week === weekendFriday
      ? metadata.wake_weekend_mode
      : undefined;
  const wakeTime =
    weekday <= 5
      ? weekdayWakeTime
      : weekendMode === 'sober'
        ? soberWakeTime
        : drinkingWakeTime;

  if (metadata.wake_last_sent !== date && isDue(clock, wakeTime)) {
    let tvResult = '';
    if (metadata.fire_tv_enabled === 'true' && metadata.fire_tv_host) {
      try {
        const links = metadata.fire_tv_media
          ? parseFireTvMedia(metadata.fire_tv_media)
          : [];
        const selected = await wakeFireTv(metadata.fire_tv_host, links);
        tvResult = selected
          ? `\n📺 Команда запуска видео отправлена: ${selected}`
          : '\n📺 Телевизор включён. Добавь ссылку в настройках ТВ, чтобы запускалось видео.';
      } catch (error) {
        logger.warnWithContext({
          userId,
          op: 'FIRE_TV_WAKE',
          error: error instanceof Error ? error.message : String(error),
        });
        tvResult =
          '\n⚠️ Не получилось разбудить телевизор. Проверь ADB и его сеть.';
      }
    }
    const message =
      weekday <= 5
        ? `⏰ Подъём — ${wakeTime}. Доброе утро! Начинаем день спокойно, без рывка.${tvResult}`
        : weekendMode === 'sober'
          ? `⏰ Подъём — ${wakeTime}. Ты выбрал выходные без алкоголя — встаём и запускаем день.${tvResult}`
          : `⏰ Подъём — ${wakeTime}. Если вчера отдых затянулся, вставай спокойно: вода, душ, без самобичевания.${tvResult}`;
    let morningMessageId: number | undefined;
    let items: string[] | undefined;
    if (weekday <= 5 && metadata.morning_enabled !== 'false') {
      items = morningItems(metadata);
      const morningMessage = await bot.api.sendMessage(
        userId,
        morningText(items, [], wakeTime, tvResult.trim()),
        { reply_markup: morningKeyboard(date, items, []) },
      );
      morningMessageId = morningMessage.message_id;
    } else await bot.api.sendMessage(userId, message);
    const latest = await queryTasks();
    latest.metadata.wake_last_sent = date;
    if (morningMessageId !== undefined && items) {
      latest.metadata.morning_active_date = date;
      latest.metadata.morning_active_items = JSON.stringify(items);
      latest.metadata.morning_message_id = String(morningMessageId);
      latest.metadata.morning_expires_at = morningExpiry(
        date,
        wakeTime,
        timezone,
      ).toISOString();
      latest.metadata.morning_wake_time = wakeTime;
      latest.metadata.morning_done = '[]';
      latest.metadata.morning_note = tvResult.trim();
    }
    if (!(await saveTasks(latest.taskData, latest.metadata)))
      throw new Error('Wake schedule was not saved');
  }
};

let running = false;
export const checkReminders = async (
  bot: Bot<BotContext>,
  now = new Date(),
) => {
  if (running) return;
  pruneUsageStats();
  running = true;
  try {
    for (const userId of profileUsers()) {
      try {
        await runForUser(userId, async () => {
          await checkUserReminders(bot, userId, now);
          await checkUserWakeSchedule(bot, userId, now);
        });
      } catch {
        logger.warnWithContext({
          userId,
          op: 'REMINDERS',
          message: 'Could not check or send reminders',
        });
      }
    }
  } finally {
    running = false;
  }
};

export const startReminderLoop = (bot: Bot<BotContext>): (() => void) => {
  void checkReminders(bot);
  const timer = setInterval(() => void checkReminders(bot), 60_000);
  return () => clearInterval(timer);
};
