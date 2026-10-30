import { describe, expect, it } from 'bun:test';
import type { Task } from '../core/types.js';
import {
  buildCoachingExport,
  createPersonalState,
  dayFor,
  dueReminders,
  localDate,
  personalStateSchema,
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
  it('keeps the first wake signal after an early plan and stops it only after waking', () => {
    const state = createPersonalState(1);
    Object.assign(state.reminders, {
      enabled: true,
      morning: '08:00',
      wakeRepeats: true,
      quietStart: '01:00',
      quietEnd: '08:00',
    });
    const day = dayFor(state, '2026-10-26');
    day.morningAt = '2026-10-25T23:10:00Z';
    const atWake = new Date('2026-10-26T07:00:00Z');
    expect(
      dueReminders(state, [], 'Europe/Berlin', atWake).map((r) => r.kind),
    ).toEqual(['morning']);
    day.awakeAt = '2026-10-26T06:59:00Z';
    expect(dueReminders(state, [], 'Europe/Berlin', atWake)).toEqual([]);
    state.reminders.wakeRepeats = false;
    delete day.awakeAt;
    expect(dueReminders(state, [], 'Europe/Berlin', atWake)).toEqual([]);
  });
  it('loads old serialized state with new routine fields safely disabled', () => {
    const state = personalStateSchema.parse({
      version: 1,
      ownerId: 1,
      days: {
        '2026-10-25': {
          mode: 'normal',
          priorities: [],
          firstStep: 'Kept',
          morningAt: '2026-10-25T07:00:00Z',
        },
      },
      reminders: {
        enabled: true,
        morning: '09:00',
        evening: '21:30',
        weekly: '18:00',
        weeklyDay: 0,
        quietStart: '22:00',
        quietEnd: '08:00',
        leadMinutes: 30,
      },
    });
    expect(state.reminders.wakeRepeats).toBe(false);
    expect(state.reminders.routine).toBe(false);
    expect(state.reminders.bedtime).toBeUndefined();
    expect(state.days['2026-10-25'].firstStep).toBe('Kept');
    expect(state.days['2026-10-25'].morningItems).toEqual([]);
    expect(state.morningItems).toHaveLength(6);
  });
  it('offers wake repeats within ten minutes and stops them after waking up', () => {
    const state = createPersonalState(1);
    Object.assign(state.reminders, {
      enabled: true,
      morning: '08:00',
      wakeRepeats: true,
      quietStart: '01:00',
      quietEnd: '08:00',
    });
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-26T07:00:00Z'),
      ).map((r) => r.kind),
    ).toEqual(['morning']);
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-26T07:05:00Z'),
      ).map((r) => r.kind),
    ).toEqual(['wake']);
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-26T07:10:00Z'),
      ).map((r) => r.kind),
    ).toEqual(['wake']);
    Object.assign(dayFor(state, '2026-10-26'), {
      awakeAt: '2026-10-26T07:06:00Z',
    });
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-26T07:10:00Z'),
      ),
    ).toEqual([]);
  });
  it('offers the bedtime reminder before quiet hours and keeps new signals off for old settings', () => {
    const state = createPersonalState(1);
    Object.assign(state.reminders, {
      enabled: true,
      bedtime: '00:45',
      quietStart: '01:00',
      quietEnd: '08:00',
    });
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-25T23:45:00Z'),
      ).map((r) => r.kind),
    ).toEqual(['bedtime']);
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-26T00:00:00Z'),
      ),
    ).toEqual([]);
    const existing = createPersonalState(1);
    existing.reminders.enabled = true;
    expect(
      dueReminders(
        existing,
        [],
        'Europe/Berlin',
        new Date('2026-10-26T07:05:00Z'),
      ),
    ).toEqual([]);
  });
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
