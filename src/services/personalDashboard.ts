import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { Metadata, Task } from '../core/types.js';
import { readScheduleEvents } from './icsCalendar.js';
import {
  createDayPlan,
  localDate,
  type PersonalState,
  shiftDate,
} from './personal.js';

export const nearestCalendarClass = (
  metadata: Metadata,
  timezone: string,
  now: Date,
) => {
  const classes = readScheduleEvents(metadata.calendar_events)
    .flatMap((event) => {
      try {
        const sourceZone = metadata.calendar_timezone || timezone;
        const start = fromZonedTime(
          `${event.date}T${event.start}:00`,
          sourceZone,
        );
        const end = fromZonedTime(`${event.date}T${event.end}:00`, sourceZone);
        if (
          !Number.isFinite(start.getTime()) ||
          !Number.isFinite(end.getTime()) ||
          end <= start ||
          end <= now
        )
          return [];
        return [
          {
            start: start.getTime(),
            date: localDate(start, timezone),
            time: formatInTimeZone(start, timezone, 'HH:mm'),
            endTime: formatInTimeZone(end, timezone, 'HH:mm'),
            title: event.title.slice(0, 150),
            location: event.location?.slice(0, 120),
            current: start <= now,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.start - b.start);
  return classes[0];
};

export const buildPersonalDashboard = (
  state: PersonalState,
  tasks: Task[],
  metadata: Metadata,
  timezone: string,
  now: Date,
) => {
  const date = localDate(now, timezone);
  const day = state.days[date] ?? createDayPlan();
  const selected = day.priorities.flatMap((id) => {
    const task = tasks.find((task) => task.id === id);
    return task ? [task] : [];
  });
  const completed = selected.filter((task) => task.completed).length;
  const nextTask = selected.find((task) => !task.completed);
  const items = day.morningItems.length ? day.morningItems : state.morningItems;
  return {
    date,
    time: formatInTimeZone(now, timezone, 'HH:mm'),
    mode: day.mode,
    firstStep:
      completed === 0
        ? day.firstStep || state.days[shiftDate(date, -1)]?.review?.next || ''
        : '',
    completed,
    total: day.priorities.length,
    missing: day.priorities.length - selected.length,
    nextTask,
    morningDone: day.morningDone.filter((index) => index < items.length).length,
    morningTotal: items.length,
    reviewDone: !!day.review,
    hasTasks: tasks.some((task) => !task.completed),
    nextClass: nearestCalendarClass(metadata, timezone, now),
  };
};

export type PersonalDashboard = ReturnType<typeof buildPersonalDashboard>;
