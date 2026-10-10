import { expect, test } from 'bun:test';
import {
  MAX_ICS_BYTES,
  parseIcsCalendar,
  readIcsResponse,
  readScheduleEvents,
} from './icsCalendar.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';

const calendar = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-TIMEZONE:Europe/Berlin
BEGIN:VEVENT
UID:one
DTSTART;TZID=Europe/Berlin:20261005T090000
DTEND;TZID=Europe/Berlin:20261005T101500
SUMMARY:International Marketing and\n  Strategy
LOCATION:Room 1, Campus
END:VEVENT
BEGIN:VEVENT
UID:cancelled
STATUS:CANCELLED
DTSTART;TZID=Europe/Berlin:20261006T090000
DTEND;TZID=Europe/Berlin:20261006T101500
SUMMARY:Cancelled lecture
END:VEVENT
END:VCALENDAR`;

test('imports timed events with timezone, escaped text and cancelled entries', () => {
  const result = parseIcsCalendar(calendar);
  expect(result.timezone).toBe('Europe/Berlin');
  expect(result.firstDate).toBe('2026-10-05');
  expect(result.lastDate).toBe('2026-10-05');
  expect(result.events).toEqual([
    {
      uid: 'one',
      date: '2026-10-05',
      start: '09:00',
      end: '10:15',
      title: 'International Marketing and Strategy',
      location: 'Room 1, Campus',
    },
  ]);
});

test('rejects unsupported input and ignores malformed stored calendar data', () => {
  expect(() => parseIcsCalendar('not a calendar')).toThrow('.ics');
  expect(readScheduleEvents('{bad')).toEqual([]);
});

test('calendar events and their source metadata survive GitHub Markdown storage', () => {
  const parsed = parseIcsCalendar(calendar);
  const metadata = {
    calendar_events: JSON.stringify(parsed.events),
    calendar_source_name: 'HM Link.ics',
    calendar_imported_at: '2026-10-10T16:00:00.000Z',
    calendar_timezone: parsed.timezone,
  };
  const markdown = serializeTaskMarkdown(
    { completed: [], uncompleted: [] },
    metadata,
  );
  const restored = deserializeTaskMarkdown(markdown).metadata;
  expect(restored.calendar_source_name).toBe(metadata.calendar_source_name);
  expect(restored.calendar_timezone).toBe(metadata.calendar_timezone);
  expect(readScheduleEvents(restored.calendar_events)).toEqual(parsed.events);
});

test('streamed ICS downloads enforce the actual byte limit', async () => {
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_ICS_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    }),
  );
  await expect(readIcsResponse(response)).rejects.toThrow('256 КБ');
});
