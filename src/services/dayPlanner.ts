import { formatInTimeZone } from 'date-fns-tz';
import type { Metadata, Task, TaskData } from '../core/types.js';
import { getQuadrant } from './eisenhower.js';

export interface BusySlot {
  id: string;
  name: string;
  days: number[];
  start: string;
  end: string;
}
export interface PlannerPreferences {
  start: string;
  end: string;
  busy: BusySlot[];
}
export interface PlanItem {
  task: Task;
  start: number;
  end: number;
  fixed: boolean;
}
export const clockMinutes = (value: string): number => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    throw new Error('Время должно быть в формате HH:MM.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
};
export const minuteClock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export const parseWindow = (value: string) => {
  const match = value.trim().match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);
  if (!match || clockMinutes(match[1]) >= clockMinutes(match[2]))
    throw new Error('Укажи интервал в пределах дня: 09:00-10:30.');
  return { start: match[1], end: match[2] };
};
export const plannerPreferences = (metadata: Metadata): PlannerPreferences => {
  if (!metadata.planner_preferences)
    return { start: '09:00', end: '22:00', busy: [] };
  const raw = JSON.parse(metadata.planner_preferences) as PlannerPreferences;
  parseWindow(`${raw.start}-${raw.end}`);
  if (!Array.isArray(raw.busy) || raw.busy.length > 30)
    throw new Error('Некорректное расписание.');
  for (const slot of raw.busy) {
    if (
      !slot ||
      typeof slot.id !== 'string' ||
      typeof slot.name !== 'string' ||
      !Array.isArray(slot.days) ||
      !slot.days.length ||
      slot.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    )
      throw new Error('Некорректное расписание.');
    parseWindow(`${slot.start}-${slot.end}`);
  }
  return raw;
};
const durationMinutes = (task: Task) => {
  const match = task.duration?.match(/^(\d+):([0-5]\d)$/);
  return match ? Math.max(1, Number(match[1]) * 60 + Number(match[2])) : 30;
};
export const buildDayPlan = (
  data: TaskData,
  metadata: Metadata,
  now = new Date(),
) => {
  const timezone = metadata.timezone || 'UTC';
  const date = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const day = Number(formatInTimeZone(now, timezone, 'i'));
  const preferences = plannerPreferences(metadata);
  const busy = preferences.busy.filter((slot) => slot.days.includes(day));
  const candidates = data.uncompleted.filter(
    (task) => !task.completed && (!task.date || task.date <= date),
  );
  // Past dated appointments are overdue work, not today's fixed appointments.
  const fixed = candidates
    .filter((task) => task.time && (!task.date || task.date === date))
    .map((task) => ({
      task,
      start: clockMinutes(task.time!),
      end: Math.min(1440, clockMinutes(task.time!) + durationMinutes(task)),
      fixed: true,
    }));
  const occupied = [
    ...busy.map((slot) => ({
      start: clockMinutes(slot.start),
      end: clockMinutes(slot.end),
    })),
    ...fixed,
  ].sort((a, b) => a.start - b.start);
  const conflicts = occupied.some((slot, index) =>
    occupied.slice(0, index).some((other) => other.end > slot.start),
  );
  let cursor = Math.max(
    clockMinutes(preferences.start),
    Math.ceil(clockMinutes(formatInTimeZone(now, timezone, 'HH:mm')) / 5) * 5,
  );
  const end = clockMinutes(preferences.end);
  const flexible = candidates
    .filter((task) => !fixed.some((item) => item.task === task))
    .sort(
      (a, b) =>
        getQuadrant(a) - getQuadrant(b) ||
        (a.date || '9999').localeCompare(b.date || '9999'),
    );
  const items: PlanItem[] = [...fixed];
  const overflow: Task[] = [];
  for (const task of flexible) {
    const duration = durationMinutes(task);
    let start = cursor;
    for (const slot of occupied)
      if (slot.end > start && slot.start < start + duration) start = slot.end;
    if (start + duration > end) {
      overflow.push(task);
      continue;
    }
    items.push({ task, start, end: start + duration, fixed: false });
    cursor = start + duration;
  }
  items.sort((a, b) => a.start - b.start);
  const completed = data.completed.filter((task) =>
    task.log?.startsWith(`Completed ${date} `),
  );
  return {
    date,
    busy,
    items,
    overflow,
    completed,
    conflicts,
    preferences,
    clock: clockMinutes(formatInTimeZone(now, timezone, 'HH:mm')),
  };
};
export const dayPlanText = (plan: ReturnType<typeof buildDayPlan>) =>
  [
    `🗓 План дня · ${plan.date}`,
    '',
    ...[
      ...plan.busy.map((slot) => ({
        start: clockMinutes(slot.start),
        text: `▪️ ${slot.start}–${slot.end} · ${slot.name}`,
      })),
      ...plan.items.map((item) => ({
        start: item.start,
        text: `${item.fixed ? '📌' : '▫️'} ${minuteClock(item.start)}–${minuteClock(item.end)} · ${item.task.name}`,
      })),
    ]
      .sort((a, b) => a.start - b.start)
      .map((item) => item.text),
    ...(!plan.busy.length && !plan.items.length
      ? ['Свободный день. Можно добавить дело.']
      : []),
    '',
    ...(plan.conflicts
      ? [
          '⚠️ В расписании есть пересечения. Проверь занятые часы и дела со временем.',
        ]
      : []),
    ...(plan.overflow.length
      ? [
          `Не поместилось: ${plan.overflow.length}`,
          ...plan.overflow.map((task) => `• ${task.name}`),
        ]
      : []),
    `Сегодня завершено: ${plan.completed.length}.`,
    '📌 — заданное время. ▫️ — предложение, ещё не записанное в календарь.',
    'Без длительности выделяю 30 минут. Это время работы, а не дедлайн.',
  ].join('\n');
export const daySummaryText = (plan: ReturnType<typeof buildDayPlan>) =>
  [
    `📊 Итог дня · ${plan.date}`,
    '',
    `Завершено: ${plan.completed.length}`,
    ...plan.completed.map(
      (task) => `✅ ${task.name} · ${task.log?.slice(21, 26) || ''}`,
    ),
    '',
    `Осталось на сегодня: ${plan.items.length + plan.overflow.length}`,
    ...[...plan.items.map((item) => item.task), ...plan.overflow].map(
      (task) => `• ${task.name}`,
    ),
    '',
    'Оставшиеся дела не переносятся автоматически. Выбери следующий шаг или перенеси отдельное дело на завтра.',
  ].join('\n');
