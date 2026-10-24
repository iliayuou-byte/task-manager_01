import { createHash } from 'node:crypto';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { Metadata, Task } from '../core/types.js';
import { readScheduleEvents } from './icsCalendar.js';

export const personalCalendarTasks = (
  metadata: Metadata,
  timezone: string,
): Task[] =>
  readScheduleEvents(metadata.calendar_events).flatMap((event) => {
    try {
      const instant = fromZonedTime(
        `${event.date}T${event.start}:00`,
        metadata.calendar_timezone || timezone,
      );
      if (Number.isNaN(instant.getTime())) return [];
      return [
        {
          id: `ics-${createHash('sha256')
            .update(`${event.uid ?? event.title}:${event.date}:${event.start}`)
            .digest('hex')
            .slice(0, 32)}`,
          name: event.title.slice(0, 150),
          date: formatInTimeZone(instant, timezone, 'yyyy-MM-dd'),
          time: formatInTimeZone(instant, timezone, 'HH:mm'),
          completed: false,
          tags: [],
        },
      ];
    } catch {
      return [];
    }
  });
