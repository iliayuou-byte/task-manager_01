import { expect, test } from 'bun:test';
import { Priority, type Task } from '../core/types.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';
import { getQuadrant, setQuadrant } from './eisenhower.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';
import { rankTasks } from './priorityEngine.js';
import { dueReminderSlot, parseReminderTimes } from './reminders.js';

const task = (name: string): Task => ({ name, completed: false, tags: [] });

test('four independent quadrants and explicit overrides of old priority', () => {
  for (const q of [1, 2, 3, 4])
    expect(getQuadrant(setQuadrant(task('A'), q))).toBe(q);
  expect(
    getQuadrant({ ...setQuadrant(task('B'), 3), priority: Priority.URGENT }),
  ).toBe(3);
});

test('matrix numbers tasks continuously and keeps each task on one line', () => {
  const lines = matrixLines([
    setQuadrant(task('urgent\nwork'), 1),
    setQuadrant(task('study'), 2),
  ]);
  expect(lines).toContain('1. urgent work');
  expect(lines).toContain('2. study');
  expect(
    splitMessages(
      matrixLines(
        Array.from({ length: 80 }, (_, i) => task(`${i} ${'x'.repeat(250)}`)),
      ),
    ).every((text) => text.length <= 3800),
  ).toBe(true);
});

test('new fields and reminder state survive markdown storage', () => {
  const data = { completed: [], uncompleted: [setQuadrant(task('A'), 3)] };
  const parsed = deserializeTaskMarkdown(
    serializeTaskMarkdown(data, {
      timezone: 'Europe/Berlin',
      reminder_times: '09:00,19:00',
      reminder_last_sent: '2026-10-05T09:00',
    }),
  );
  expect(getQuadrant(parsed.taskData.uncompleted[0])).toBe(3);
  expect(parsed.metadata.reminder_last_sent).toBe('2026-10-05T09:00');
  expect(parsed.metadata.reminder_times).toBe('09:00,19:00');
});

test('old twelve-column task rows remain readable', () => {
  const content =
    '| Completed | Task | Date | Time | Duration | Priority | Tags | Description | Link | CalendarEventId | Log | RecurrenceRule |\n| :--- | :--- |\n| [ ] | Old task | | | | high | | | | | | |';
  const parsed = deserializeTaskMarkdown(content);
  expect(parsed.taskData.uncompleted[0].name).toBe('Old task');
  expect(getQuadrant(parsed.taskData.uncompleted[0])).toBe(2);
});

test('reminders use local timezone, grace window and saved deduplication', () => {
  const now = new Date('2026-10-05T07:05:00Z');
  expect(dueReminderSlot(['09:00'], now, 'Europe/Berlin')).toBe(
    '2026-10-05T09:00',
  );
  expect(
    dueReminderSlot(['09:00'], now, 'Europe/Berlin', '2026-10-05T09:00'),
  ).toBeUndefined();
  expect(
    dueReminderSlot(
      ['09:00'],
      new Date('2026-10-05T09:00:00Z'),
      'Europe/Berlin',
    ),
  ).toBeUndefined();
  expect(parseReminderTimes('19:00 09:00 09:00')).toEqual(['09:00', '19:00']);
  expect(parseReminderTimes('off')).toEqual([]);
  expect(() => parseReminderTimes('25:99')).toThrow();
});

test('next action respects important nonurgent before unimportant urgent work', () => {
  const ranked = rankTasks(
    [setQuadrant(task('urgent chore'), 3), setQuadrant(task('study'), 2)],
    new Date(),
    'UTC',
  );
  expect(ranked[0].task.name).toBe('study');
});
