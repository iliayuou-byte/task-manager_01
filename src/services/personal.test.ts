import { describe, expect, it } from 'bun:test';
import type { Task } from '../core/types.js';
import {
  buildCoachingExport,
  createPersonalState,
  dayFor,
  dueReminders,
  localDate,
  setPriorities,
  shiftDate,
  weeklySummary,
} from './personal.js';

const now = new Date('2026-10-24T10:00:00Z');
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  name: `Task ${id}`,
  completed: false,
  tags: ['study'],
  ...extra,
});

describe('Personal planning', () => {
  it('uses the local date and calendar arithmetic across DST', () => {
    expect(localDate(new Date('2026-10-24T23:30:00Z'), 'Europe/Berlin')).toBe(
      '2026-10-25',
    );
    expect(shiftDate('2026-10-24', 90)).toBe('2027-01-22');
  });

  it('keeps priorities stable after reorder/rename and refuses more than three', () => {
    const day = dayFor(createPersonalState(1), '2026-10-24');
    setPriorities(day, ['a', 'b'], [task('b'), task('a', { name: 'Renamed' })]);
    expect(day.priorities).toEqual(['a', 'b']);
    expect(() =>
      setPriorities(
        day,
        ['a', 'b', 'c', 'd'],
        ['a', 'b', 'c', 'd'].map((id) => task(id)),
      ),
    ).toThrow();
    expect(() => setPriorities(day, ['x'], [task('a')])).toThrow();
    expect(day.priorities).toEqual(['a', 'b']);
  });

  it('counts actual completion dates rather than scheduled dates', () => {
    const state = createPersonalState(1);
    dayFor(state, '2026-10-24').review = {
      energy: 2,
      win: 'secret',
      blocker: '',
      next: '',
    };
    const summary = weeklySummary(
      state,
      [
        task('a', {
          completed: true,
          date: '2026-09-01',
          completedAt: now.toISOString(),
        }),
        task('b', { completed: true, date: '2026-10-24' }),
        task('c', { completed: true, completedAt: '2026-10-01T10:00:00Z' }),
      ],
      'Europe/Berlin',
      now,
    );
    expect(summary.completed).toBe(1);
    expect(summary.unknownCompletionDates).toBe(1);
    expect(summary.areas.study).toBe(1);
    expect(summary.reviewedDays).toBe(1);
  });

  it('requires consent and exports only explicit aggregate fields', () => {
    const state = createPersonalState(1);
    dayFor(state, '2026-10-24').review = {
      energy: 2,
      win: 'secret win',
      blocker: 'secret blocker',
      next: 'secret next',
    };
    expect(() =>
      buildCoachingExport(state, [], 'Europe/Berlin', now),
    ).toThrow();
    state.coaching = { enabled: true, consentedAt: now.toISOString() };
    const exported = JSON.stringify(
      buildCoachingExport(
        state,
        [task('secret-id', { name: 'secret task' })],
        'Europe/Berlin',
        now,
      ),
    );
    expect(exported).not.toContain('secret');
    expect(exported).not.toContain('ownerId');
    expect(exported).not.toContain('consentedAt');
    state.coaching.enabled = false;
    expect(() =>
      buildCoachingExport(state, [], 'Europe/Berlin', now),
    ).toThrow();
  });

  it('offers reminders only within their local window, respects quiet hours and sent keys', () => {
    const state = createPersonalState(1);
    state.reminders.enabled = true;
    const morning = new Date('2026-10-24T07:00:00Z');
    const reminders = dueReminders(state, [], 'Europe/Berlin', morning);
    expect(reminders.map((r) => r.kind)).toContain('morning');
    state.deliveries[reminders[0].key] = {
      status: 'sent',
      at: morning.toISOString(),
    };
    expect(dueReminders(state, [], 'Europe/Berlin', morning)).toHaveLength(0);
    expect(dueReminders(state, [], 'Europe/Berlin', now)).toHaveLength(0);
    expect(
      dueReminders(
        state,
        [task('a', { date: '2026-10-25', time: '00:15' })],
        'Europe/Berlin',
        new Date('2026-10-24T21:45:00Z'),
      ),
    ).toHaveLength(0);
  });

  it('reminds of future events but never expired events or date-only tasks', () => {
    const state = createPersonalState(1);
    state.reminders.enabled = true;
    const list = [
      task('a', { date: '2026-10-24', time: '12:30' }),
      task('b', { date: '2026-10-24', time: '11:30' }),
      task('c', { date: '2026-10-24' }),
    ];
    expect(
      dueReminders(state, list, 'Europe/Berlin', now).map((r) => r.kind),
    ).toEqual(['event']);
  });
});
