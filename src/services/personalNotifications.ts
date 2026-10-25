import type { InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import {
  personalReminderKeyboard,
  planMessage,
  weekMessage,
} from '../views/personalView.js';
import { dueReminders, localDate, type Reminder } from './personal.js';
import { personalCalendarTasks } from './personalCalendar.js';
import {
  getPersonalStore,
  type PersonalStore,
  personalEnabled,
} from './personalStore.js';
import { queryTasks } from './queryTasks.js';
import { profileOwner, runForUser } from './userScope.js';

export type PersonalReminderSender = (
  ownerId: number,
  text: string,
  options?: { reply_markup: InlineKeyboard },
) => Promise<unknown>;

export const checkPersonalReminders = async (send: PersonalReminderSender) => {
  if (!personalEnabled()) return 0;
  const owner = profileOwner();
  if (!owner) return 0;
  return runForUser(owner, async () => {
    const store = await getPersonalStore();
    if (!(await store.read()).reminders.enabled) return 0;
    const { taskData, metadata } = await queryTasks();
    if (!metadata.timezone) return 0;
    return dispatchPersonalReminders(
      store,
      [
        ...taskData.uncompleted,
        ...taskData.completed,
        ...personalCalendarTasks(metadata, metadata.timezone),
      ],
      metadata.timezone,
      send,
    );
  });
};

export const dispatchPersonalReminders = async (
  store: PersonalStore,
  tasks: Task[],
  timezone: string,
  send: PersonalReminderSender,
  time: Date | (() => Date) = () => new Date(),
) => {
  const clock = time instanceof Date ? () => time : time;
  const initial = await store.read();
  const reminders = dueReminders(initial, tasks, timezone, clock());
  let sent = 0;
  for (const reminder of reminders) {
    const claim = crypto.randomUUID();
    const state = await store.update((state) => {
      const now = clock();
      if (
        !dueReminders(state, tasks, timezone, now).some(
          (item) => item.key === reminder.key,
        )
      )
        return;
      state.deliveries[reminder.key] = {
        status: 'sending',
        at: now.toISOString(),
        claim,
      };
      for (const [key, value] of Object.entries(state.deliveries)) {
        if (now.getTime() - Date.parse(value.at) > 14 * 86400000)
          delete state.deliveries[key];
      }
    });
    if (state.deliveries[reminder.key]?.claim !== claim) continue;
    const fresh = await store.read();
    const now = clock();
    if (
      !fresh.reminders.enabled ||
      fresh.deliveries[reminder.key]?.claim !== claim ||
      !dueReminders(fresh, tasks, timezone, now, claim).some(
        (item) => item.key === reminder.key,
      )
    )
      continue;
    const message = reminderMessage(reminder, fresh, tasks, timezone, now);
    await send(store.ownerId, message, {
      reply_markup: personalReminderKeyboard(
        reminder,
        localDate(now, timezone),
      ),
    });
    await store.update((state) => {
      if (state.deliveries[reminder.key]?.claim === claim) {
        state.deliveries[reminder.key] = {
          status: 'sent',
          at: clock().toISOString(),
        };
      }
    });
    sent++;
  }
  return sent;
};

const reminderMessage = (
  reminder: Reminder,
  state: Awaited<ReturnType<PersonalStore['read']>>,
  tasks: Task[],
  timezone: string,
  now: Date,
) => {
  switch (reminder.kind) {
    case 'wake':
      return '⏰ Пора вставать. Начни с одного действия: встань и открой шторы.\nНажми «Я встал», чтобы остановить повторы этого утра.';
    case 'bedtime':
      return '🌙 Время готовиться ко сну. Заверши текущие дела, подготовь вещи на утро и отложи телефон.';
    case 'morning':
      return `Доброе утро. Открой /morning и выбери до трёх результатов.\n\n${planMessage(state, tasks, timezone, now)}`.slice(
        0,
        4000,
      );
    case 'evening':
      return 'День можно завершить коротким обзором. /evening\nЧто получилось, что мешало, какой первый шаг завтра?';
    case 'weekly':
      return `${weekMessage(state, tasks, timezone, now)}\n\n/goals — свериться с целями.`;
    case 'event':
      return `Скоро ${reminder.task?.time} · ${reminder.task?.name.slice(0, 500)}\nПроверь время на сборы и дорогу. /morning`;
  }
};
