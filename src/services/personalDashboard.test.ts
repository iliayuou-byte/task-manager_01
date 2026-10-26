import { expect, test } from 'bun:test';
import type { Metadata, Task } from '../core/types.js';
import { createDayPlan, createPersonalState } from './personal.js';
import { buildPersonalDashboard } from './personalDashboard.js';

test('dashboard keeps chosen progress, morning snapshot and deleted priorities without writing state', () => {
  const state = createPersonalState(1);
  state.days['2026-10-26'] = {
    ...createDayPlan(),
    priorities: ['done', 'missing', 'next'],
    mode: 'low',
    morningItems: ['Вода', 'Шторы'],
    morningDone: [0],
    firstStep: 'Старый первый шаг',
  };
  const tasks: Task[] = [
    { id: 'done', name: 'Готовое', tags: [], completed: true },
    { id: 'next', name: 'Следующее', tags: [], completed: false },
  ];
  const before = structuredClone({ state, tasks });
  const view = buildPersonalDashboard(
    state,
    tasks,
    {},
    'Europe/Berlin',
    new Date('2026-10-26T12:00:00Z'),
  );
  expect(view).toMatchObject({
    completed: 1,
    total: 3,
    missing: 1,
    mode: 'low',
    morningDone: 1,
    morningTotal: 2,
    firstStep: '',
  });
  expect(view.nextTask?.id).toBe('next');
  expect({ state, tasks }).toEqual(before);
});

test('nearest class includes an ongoing lesson and then advances to tomorrow in owner time', () => {
  const state = createPersonalState(1);
  const metadata: Metadata = {
    calendar_timezone: 'UTC',
    calendar_events: JSON.stringify([
      { date: '2026-10-27', start: '08:00', end: '09:00', title: 'Завтрашняя' },
      {
        date: '2026-10-26',
        start: '09:00',
        end: '10:30',
        title: 'Текущая',
        location: 'Зал 1',
      },
      { date: '2026-10-26', start: '07:00', end: '08:00', title: 'Прошедшая' },
      { date: 'bad', start: 'xx', end: 'xx', title: 'Некорректная' },
    ]),
  };
  expect(
    buildPersonalDashboard(
      state,
      [],
      metadata,
      'Europe/Berlin',
      new Date('2026-10-26T09:15:00Z'),
    ).nextClass,
  ).toMatchObject({
    title: 'Текущая',
    date: '2026-10-26',
    time: '10:00',
    endTime: '11:30',
    current: true,
    location: 'Зал 1',
  });
  expect(
    buildPersonalDashboard(
      state,
      [],
      metadata,
      'Europe/Berlin',
      new Date('2026-10-26T10:30:00Z'),
    ).nextClass,
  ).toMatchObject({
    title: 'Завтрашняя',
    date: '2026-10-27',
    time: '09:00',
    current: false,
  });
  expect(
    buildPersonalDashboard(
      state,
      [],
      metadata,
      'Europe/Berlin',
      new Date('2026-10-28T12:00:00Z'),
    ).nextClass,
  ).toBeUndefined();
});
