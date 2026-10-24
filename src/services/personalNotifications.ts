import type { Task } from '../core/types.js';
import { planMessage, weekMessage } from '../views/personalView.js';
import { dueReminders, type Reminder } from './personal.js';
import {
  getPersonalStore,
  type PersonalStore,
  personalEnabled,
} from './personalStore.js';
import { queryTasks } from './queryTasks.js';

export const checkPersonalReminders = async (
  send: (ownerId: number, text: string) => Promise<unknown>,
) => {
  if (!personalEnabled()) return 0;
  const store = await getPersonalStore();
  if (!(await store.read()).reminders.enabled) return 0;
  const { taskData, metadata } = await queryTasks();
  if (!metadata.timezone) return 0;
  return dispatchPersonalReminders(
    store,
    [...taskData.uncompleted, ...taskData.completed],
    metadata.timezone,
    send,
  );
};

export const dispatchPersonalReminders = async (
  store: PersonalStore,
  tasks: Task[],
  timezone: string,
  send: (ownerId: number, text: string) => Promise<unknown>,
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
    await send(store.ownerId, message);
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
