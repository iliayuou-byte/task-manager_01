import { describe, expect, it } from 'bun:test';
import type { Task } from '../core/types.js';
import { parseUserText } from '../utils/index.js';
import { planMessage } from '../views/personalView.js';
import {
  deserializeTaskMarkdown,
  serializeTaskMarkdown,
} from './markdownParser.js';
import { createPersonalState, dayFor, dueReminders } from './personal.js';

describe('Personal data compatibility', () => {
  it('preserves goal hashtags and pipe characters in task names', () => {
    const parsed = parseUserText('Read A | B #study #goal-ab123');
    const task: Task = {
      id: 'a',
      name: parsed.text,
      completed: false,
      tags: parsed.tags,
    };
    const result = deserializeTaskMarkdown(
      serializeTaskMarkdown(
        { uncompleted: [task], completed: [] },
        { timezone: 'Europe/Berlin' },
      ),
    ).taskData.uncompleted[0];
    expect(result.name).toBe('Read A | B');
    expect(result.tags).toEqual(['study', 'goal-ab123']);
    expect(result.id).toBe('a');
  });

  it('reduces the visible plan without discarding priorities or moving missed events', () => {
    const state = createPersonalState(1);
    const day = dayFor(state, '2026-10-24');
    day.priorities = ['a', 'b'];
    day.mode = 'late';
    const tasks: Task[] = [
      { id: 'a', name: 'First', completed: false, tags: [] },
      { id: 'b', name: 'Second', completed: false, tags: [] },
      {
        id: 'c',
        name: 'Missed',
        date: '2026-10-24',
        time: '09:00',
        completed: false,
        tags: [],
      },
      {
        id: 'd',
        name: 'Future',
        date: '2026-10-24',
        time: '16:00',
        completed: false,
        tags: [],
      },
    ];
    const before = JSON.stringify({ state, tasks });
    const view = planMessage(
      state,
      tasks,
      'Europe/Berlin',
      new Date('2026-10-24T10:00:00Z'),
    );
    expect(view).toContain('First');
    expect(view).not.toContain('Second');
    expect(view).toContain('16:00 · Future');
    expect(view).toContain('Прошедших слотов: 1');
    expect(JSON.stringify({ state, tasks })).toBe(before);
  });

  it('deduplicates a repeated local hour on DST rollback and supports daytime quiet periods', () => {
    const state = createPersonalState(1);
    state.reminders.enabled = true;
    state.reminders.morning = '02:30';
    state.reminders.quietStart = '12:00';
    state.reminders.quietEnd = '13:00';
    const first = new Date('2026-10-25T00:30:00Z');
    const due = dueReminders(state, [], 'Europe/Berlin', first);
    expect(due.some((item) => item.kind === 'morning')).toBe(true);
    state.deliveries[due[0].key] = { status: 'sent', at: first.toISOString() };
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-25T01:30:00Z'),
      ),
    ).toHaveLength(0);
    state.reminders.morning = '12:00';
    expect(
      dueReminders(
        state,
        [],
        'Europe/Berlin',
        new Date('2026-10-25T11:00:00Z'),
      ),
    ).toHaveLength(0);
  });
});
