import { expect, test } from 'bun:test';
import type { Metadata, TaskData } from '../core/types.js';
import { buildDayPlan, daySummaryText, parseWindow } from './dayPlanner.js';
import { parseMarkdown, serializeTaskMarkdown } from './markdownParser.js';

const metadata: Metadata = {
  timezone: 'Europe/Berlin',
  planner_preferences: JSON.stringify({
    start: '09:00',
    end: '18:00',
    busy: [
      {
        id: 'lecture',
        name: 'Лекции',
        days: [5],
        start: '09:30',
        end: '12:00',
      },
    ],
  }),
};
test('day plan fits flexible tasks around recurring hours and fixed appointments without writing them', () => {
  const data: TaskData = {
    completed: [],
    uncompleted: [
      {
        name: 'Проект',
        completed: false,
        tags: [],
        duration: '1:00',
        important: true,
        urgent: true,
      },
      {
        name: 'Встреча',
        completed: false,
        tags: [],
        date: '2026-10-09',
        time: '13:00',
        duration: '1:00',
      },
      { name: 'Позже', completed: false, tags: [], date: '2026-10-10' },
    ],
  };
  const before = JSON.stringify(data);
  const plan = buildDayPlan(data, metadata, new Date('2026-10-09T07:00:00Z'));
  expect(
    plan.items.map((item) => [item.task.name, item.start, item.end]),
  ).toEqual([
    ['Проект', 720, 780],
    ['Встреча', 780, 840],
  ]);
  expect(plan.conflicts).toBe(false);
  expect(JSON.stringify(data)).toBe(before);
});
test('past appointments become flexible work; overlaps are flagged and overflow is explicit', () => {
  const data: TaskData = {
    completed: [],
    uncompleted: [
      {
        name: 'Пропущено',
        completed: false,
        tags: [],
        date: '2026-10-08',
        time: '09:00',
        duration: '1:00',
      },
      {
        name: 'Конфликт',
        completed: false,
        tags: [],
        date: '2026-10-09',
        time: '10:00',
        duration: '1:00',
      },
      { name: 'Большое', completed: false, tags: [], duration: '9:00' },
    ],
  };
  const plan = buildDayPlan(data, metadata, new Date('2026-10-09T07:00:00Z'));
  expect(plan.conflicts).toBe(true);
  expect(plan.items.find((item) => item.task.name === 'Пропущено')?.fixed).toBe(
    false,
  );
  expect(plan.overflow.map((task) => task.name)).toContain('Большое');
});
test('completed history and local date drive the daily summary and planner settings survive Markdown storage', () => {
  const settings = {
    ...metadata,
    planner_notify_times: '08:00,21:00',
    planner_last_sent: '2026-10-09T08:00',
  };
  const data: TaskData = {
    uncompleted: [],
    completed: [
      {
        name: 'Сделано',
        completed: true,
        tags: [],
        log: 'Completed 2026-10-09 12:30:00 (Europe/Berlin)',
      },
      {
        name: 'Вчера',
        completed: true,
        tags: [],
        log: 'Completed 2026-10-08 12:30:00 (Europe/Berlin)',
      },
    ],
  };
  expect(
    parseMarkdown(serializeTaskMarkdown(data, settings)).metadata,
  ).toMatchObject(settings);
  const text = daySummaryText(
    buildDayPlan(data, settings, new Date('2026-10-09T18:00:00Z')),
  );
  expect(text).toContain('Сделано · 12:30');
  expect(text).not.toContain('Вчера');
  expect(() => parseWindow('18:00-09:00')).toThrow();
  expect(() => parseWindow('25:00-26:00')).toThrow();
});

test('routine assignments respect local weekdays, overnight sleep and storage round trips', () => {
  const settings = {
    timezone: 'Europe/Berlin',
    planner_preferences: JSON.stringify({
      start: '06:00',
      end: '22:00',
      busy: [],
      templates: [
        {
          id: 'rest',
          name: 'Режим',
          blocks: [
            { name: 'Сон', start: '23:00', end: '08:00' },
            { name: 'Завтрак', start: '08:00', end: '09:00' },
          ],
        },
      ],
      weekTemplates: { '5': 'rest' },
    }),
  };
  const data: TaskData = {
    completed: [],
    uncompleted: [{ name: 'Дело', completed: false, tags: [] }],
  };
  const parsed = parseMarkdown(serializeTaskMarkdown(data, settings));
  const friday = buildDayPlan(
    {
      uncompleted: parsed.tasks.filter((task) => !task.completed),
      completed: parsed.tasks.filter((task) => task.completed),
    },
    parsed.metadata,
    new Date('2026-10-09T04:00:00Z'),
  );
  expect(friday.routine?.name).toBe('Режим');
  expect(friday.items[0].start).toBe(540);
  expect(friday.conflicts).toBe(false);
  const saturday = buildDayPlan(
    data,
    settings,
    new Date('2026-10-10T04:00:00Z'),
  );
  expect(saturday.routine).toBeUndefined();
  expect(saturday.items[0].start).toBe(360);
});
