import { describe, expect, it } from 'bun:test';
import { parseIcsCalendar } from './icsCalendar.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';
import { createPersonalState } from './personal.js';
import { personalCalendarTasks } from './personalCalendar.js';
import { dispatchPersonalReminders } from './personalNotifications.js';
import { PersonalStore } from './personalStore.js';

describe('Imported schedule in personal planning', () => {
  it('preserves event-specific timezones through import, storage and personal planning', () => {
    const source = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:berlin
DTSTART;TZID=Europe/Berlin:20261005T120000
DTEND;TZID=Europe/Berlin:20261005T130000
SUMMARY:Berlin class
END:VEVENT
BEGIN:VEVENT
UID:new-york
DTSTART;TZID=America/New_York:20261005T060000
DTEND;TZID=America/New_York:20261005T070000
SUMMARY:New York class
END:VEVENT
BEGIN:VEVENT
UID:utc
DTSTART:20261005T100000Z
DTEND:20261005T110000Z
SUMMARY:UTC class
END:VEVENT
END:VCALENDAR`;
    for (const header of ['', 'X-WR-TIMEZONE:Europe/Berlin\n']) {
      const parsed = parseIcsCalendar(
        source.replace('VERSION:2.0\n', `VERSION:2.0\n${header}`),
      );
      const restored = deserializeTaskMarkdown(
        serializeTaskMarkdown(
          { uncompleted: [], completed: [] },
          {
            timezone: 'Europe/Berlin',
            calendar_timezone: parsed.timezone,
            calendar_events: JSON.stringify(parsed.events),
          },
        ),
      ).metadata;
      expect(
        personalCalendarTasks(restored, 'Europe/Berlin').map(
          (task) => task.time,
        ),
      ).toEqual(['12:00', '12:00', '12:00']);
      expect(parsed.events.map((event) => event.end)).toEqual(
        header ? ['13:00', '13:00', '13:00'] : ['11:00', '11:00', '11:00'],
      );
    }
    const quoted = parseIcsCalendar(
      source.replace(/TZID=([A-Za-z_/]+)/g, 'TZID="$1"'),
    );
    expect(quoted.events.map((event) => event.start)).toEqual([
      '10:00',
      '10:00',
      '10:00',
    ]);
  });
  const metadata = {
    calendar_timezone: 'UTC',
    calendar_events: JSON.stringify([
      {
        uid: 'class-1',
        date: '2026-11-01',
        start: '23:30',
        end: '23:59',
        title: 'Physics',
      },
    ]),
  };
  it('converts the schedule timezone, keeps stable IDs and skips unreadable entries', () => {
    const [task] = personalCalendarTasks(metadata, 'Europe/Berlin');
    expect(task.date).toBe('2026-11-02');
    expect(task.time).toBe('00:30');
    expect(personalCalendarTasks(metadata, 'Europe/Berlin')[0].id).toBe(
      task.id,
    );
    expect(personalCalendarTasks({ calendar_events: 'broken' }, 'UTC')).toEqual(
      [],
    );
    expect(
      personalCalendarTasks(
        { ...metadata, calendar_timezone: 'invalid' },
        'UTC',
      ),
    ).toEqual([]);
  });
  it('notifies once for a class without modifying the imported calendar', async () => {
    let state = createPersonalState(1);
    state.reminders.enabled = true;
    state.reminders.quietStart = state.reminders.quietEnd;
    const store = new PersonalStore(1, {
      read: async () => ({ state: structuredClone(state) }),
      write: async (next) => {
        state = structuredClone(next);
      },
    });
    const sent: string[] = [];
    const now = new Date('2026-11-01T23:00:00Z');
    const send = async (_owner: number, text: string) => {
      sent.push(text);
    };
    const original = metadata.calendar_events;
    await dispatchPersonalReminders(
      store,
      personalCalendarTasks(metadata, 'Europe/Berlin'),
      'Europe/Berlin',
      send,
      now,
    );
    await dispatchPersonalReminders(
      store,
      personalCalendarTasks(metadata, 'Europe/Berlin'),
      'Europe/Berlin',
      send,
      now,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('00:30 · Physics');
    expect(metadata.calendar_events).toBe(original);
  });
});
