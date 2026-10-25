import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import type { Task } from '../core/types.js';
import { parseDurationInMinutes } from '../utils/index.js';

export const AREAS = ['study', 'gym', 'project', 'social', 'life'] as const;
export type Area = (typeof AREAS)[number];
export const MORNING_START_ITEMS = [
  'Встать и открыть шторы',
  'Выпить воды',
  'Умыться и почистить зубы',
  'Пять минут лёгкой разминки',
  'Позавтракать и собрать вещи',
  'Посмотреть пары и три результата дня',
];
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const note = z.string().max(400);
const daySchema = z.object({
  mode: z.enum(['normal', 'late', 'low']).default('normal'),
  usedLate: z.boolean().default(false),
  usedLow: z.boolean().default(false),
  priorities: z.array(z.string()).max(3).default([]),
  morningAt: z.string().optional(),
  awakeAt: z.string().optional(),
  morningItems: z.array(z.string().min(1).max(60)).max(8).default([]),
  morningDone: z.array(z.number().int().min(0).max(7)).max(8).default([]),
  firstStep: note.default(''),
  review: z
    .object({
      energy: z.number().int().min(1).max(5),
      win: note,
      blocker: note,
      next: note,
    })
    .optional(),
});
export const personalStateSchema = z.object({
  version: z.literal(1),
  ownerId: z.number().int().positive(),
  days: z.record(z.string(), daySchema).default({}),
  goals: z
    .array(
      z.object({
        id: z.string(),
        area: z.enum(AREAS),
        title: note,
        start: z.string(),
        deadline: z.string(),
        target: z.number().positive(),
        current: z.number().nonnegative().default(0),
        weeklyAction: note,
      }),
    )
    .default([]),
  morningItems: z
    .array(z.string().trim().min(1).max(60))
    .min(1)
    .max(8)
    .default(MORNING_START_ITEMS),
  reminders: z
    .object({
      enabled: z.boolean().default(false),
      morning: clock.default('09:00'),
      wakeRepeats: z.boolean().default(false),
      routine: z.boolean().default(false),
      bedtime: clock.optional(),
      evening: clock.default('21:30'),
      weekly: clock.default('18:00'),
      weeklyDay: z.number().int().min(0).max(6).default(0),
      quietStart: clock.default('22:00'),
      quietEnd: clock.default('08:00'),
      leadMinutes: z.number().int().min(1).max(180).default(30),
    })
    .prefault({}),
  deliveries: z
    .record(
      z.string(),
      z.object({
        status: z.enum(['sending', 'sent']),
        at: z.string(),
        claim: z.string().optional(),
      }),
    )
    .default({}),
  coaching: z
    .object({
      enabled: z.boolean().default(false),
      consentedAt: z.string().optional(),
    })
    .prefault({}),
});
export type PersonalState = z.infer<typeof personalStateSchema>;
export type DayPlan = z.infer<typeof daySchema>;
export type Goal = PersonalState['goals'][number];

export const createPersonalState = (ownerId: number): PersonalState =>
  personalStateSchema.parse({ version: 1, ownerId });
export const localDate = (now: Date, timezone: string): string =>
  formatInTimeZone(now, timezone, 'yyyy-MM-dd');
export const shiftDate = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export const createDayPlan = (): DayPlan => daySchema.parse({});
export const dayFor = (state: PersonalState, date: string): DayPlan => {
  state.days[date] ??= createDayPlan();
  if (state.days[date].mode === 'late') state.days[date].usedLate = true;
  if (state.days[date].mode === 'low') state.days[date].usedLow = true;
  return state.days[date];
};

export const setPriorities = (day: DayPlan, ids: string[], tasks: Task[]) => {
  const unique = [...new Set(ids)];
  if (unique.length > 3) throw new Error('Выбери не больше трёх приоритетов.');
  if (
    unique.some(
      (id) => !tasks.some((task) => task.id === id && !task.completed),
    )
  ) {
    throw new Error('Задача уже завершена или удалена. Открой /focus заново.');
  }
  day.priorities = unique;
};
export const areaOf = (task: Task): Area =>
  AREAS.find((area) =>
    task.tags.some((tag) => {
      const value = tag.replace(/^#/, '').toLowerCase();
      const aliases: Record<string, Area> = {
        учёба: 'study',
        учеба: 'study',
        проекты: 'project',
        зал: 'gym',
        общение: 'social',
      };
      return (aliases[value] ?? value) === area;
    }),
  ) ?? 'life';
const completionDate = (task: Task, timezone: string): string | undefined => {
  if (task.completedAt && !Number.isNaN(Date.parse(task.completedAt))) {
    return localDate(new Date(task.completedAt), timezone);
  }
  return task.log?.match(/^Completed (\d{4}-\d{2}-\d{2}) /)?.[1];
};
export const weeklySummary = (
  state: PersonalState,
  tasks: Task[],
  timezone: string,
  now = new Date(),
) => {
  const end = localDate(now, timezone);
  const start = shiftDate(end, -6);
  const days = Object.entries(state.days).filter(
    ([date]) => date >= start && date <= end,
  );
  const completed = tasks.filter((task) => {
    const date = completionDate(task, timezone);
    return task.completed && date && date >= start && date <= end;
  });
  const areas = Object.fromEntries(
    AREAS.map((area) => [
      area,
      completed.filter((task) => areaOf(task) === area).length,
    ]),
  );
  const energies = days.flatMap(([, day]) =>
    day.review ? [day.review.energy] : [],
  );
  return {
    start,
    end,
    completed: completed.length,
    unknownCompletionDates: tasks.filter(
      (task) => task.completed && !completionDate(task, timezone),
    ).length,
    reviewedDays: energies.length,
    plannedDays: days.filter(([, day]) => day.morningAt).length,
    averageEnergy: energies.length
      ? Math.round(
          (10 * energies.reduce((a, b) => a + b, 0)) / energies.length,
        ) / 10
      : null,
    lateDays: days.filter(([, day]) => day.usedLate || day.mode === 'late')
      .length,
    lowEnergyDays: days.filter(([, day]) => day.usedLow || day.mode === 'low')
      .length,
    areas,
  };
};
export const buildCoachingExport = (
  state: PersonalState,
  tasks: Task[],
  timezone: string,
  now = new Date(),
) => {
  if (!state.coaching.enabled || !state.coaching.consentedAt) {
    throw new Error('Сначала прочитай /coaching и дай согласие.');
  }
  return {
    schemaVersion: 1,
    period: weeklySummary(state, tasks, timezone, now),
    goals: state.goals.map((goal) => ({
      area: goal.area,
      target: goal.target,
      current: goal.current,
      deadline: goal.deadline,
    })),
  };
};
export interface Reminder {
  key: string;
  kind: 'morning' | 'wake' | 'bedtime' | 'evening' | 'weekly' | 'event';
  date?: string;
  task?: Task;
}
export const dueReminders = (
  state: PersonalState,
  tasks: Task[],
  timezone: string,
  now = new Date(),
  activeClaim?: string,
): Reminder[] => {
  const settings = state.reminders;
  if (!settings.enabled) return [];
  const date = localDate(now, timezone);
  const current = parseDurationInMinutes(
    formatInTimeZone(now, timezone, 'HH:mm'),
  );
  const start = parseDurationInMinutes(settings.quietStart);
  const end = parseDurationInMinutes(settings.quietEnd);
  const quiet =
    start === end
      ? false
      : start < end
        ? current >= start && current < end
        : current >= start || current < end;
  if (quiet) return [];
  const reminders: Reminder[] = [];
  const inWindow = (time: string) =>
    current >= parseDurationInMinutes(time) &&
    current < parseDurationInMinutes(time) + 5;
  const morningAcknowledged = settings.wakeRepeats
    ? state.days[date]?.awakeAt
    : state.days[date]?.morningAt;
  if (inWindow(settings.morning) && !morningAcknowledged)
    reminders.push({ key: `morning:${date}`, kind: 'morning' });
  if (settings.wakeRepeats) {
    for (const wakeDate of [shiftDate(date, -1), date]) {
      if (state.days[wakeDate]?.awakeAt) continue;
      const wake = fromZonedTime(
        `${wakeDate}T${settings.morning}:00`,
        timezone,
      ).getTime();
      for (const offset of [5, 10]) {
        const elapsed = (now.getTime() - wake) / 60000 - offset;
        if (elapsed >= 0 && elapsed < 5)
          reminders.push({
            key: `wake:${wakeDate}:${offset}`,
            kind: 'wake',
            date: wakeDate,
          });
      }
    }
  }
  if (settings.bedtime && inWindow(settings.bedtime))
    reminders.push({ key: `bedtime:${date}`, kind: 'bedtime' });
  if (inWindow(settings.evening) && !state.days[date]?.review)
    reminders.push({ key: `evening:${date}`, kind: 'evening' });
  if (
    new Date(`${date}T12:00:00Z`).getUTCDay() === settings.weeklyDay &&
    inWindow(settings.weekly)
  )
    reminders.push({ key: `weekly:${date}`, kind: 'weekly' });
  for (const task of tasks) {
    if (task.completed || !task.id || !task.date || !task.time) continue;
    const until =
      (fromZonedTime(`${task.date}T${task.time}:00`, timezone).getTime() -
        now.getTime()) /
      60000;
    if (
      until > 0 &&
      until <= settings.leadMinutes &&
      until > settings.leadMinutes - 5
    ) {
      reminders.push({
        key: `event:${task.id}:${task.date}:${task.time}`,
        kind: 'event',
        task,
      });
    }
  }
  return reminders.filter((reminder) => {
    const delivery = state.deliveries[reminder.key];
    return (
      !delivery ||
      (activeClaim !== undefined && delivery.claim === activeClaim) ||
      (delivery.status === 'sending' &&
        now.getTime() - Date.parse(delivery.at) >= 60000)
    );
  });
};
