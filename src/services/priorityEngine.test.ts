import { describe, expect, test } from 'bun:test';
import { Priority, type Task } from '../core/types.js';
import { rankTasks } from './priorityEngine.js';

const task = (name: string, extra: Partial<Task> = {}): Task => ({
  name,
  completed: false,
  tags: [],
  ...extra,
});
const now = new Date('2026-10-04T22:30:00Z');

describe('next task selection', () => {
  test('uses local day and excludes completed and future scheduled tasks', () => {
    const ranked = rankTasks(
      [
        task('today', { date: '2026-10-05' }),
        task('tomorrow', { date: '2026-10-06', priority: Priority.URGENT }),
        task('later today', { date: '2026-10-05', time: '12:00' }),
        task('done', { completed: true }),
      ],
      now,
      'Europe/Berlin',
    );
    expect(ranked.map((item) => item.task.name)).toEqual(['today']);
  });
  test('priority outweighs a short low priority task', () => {
    const ranked = rankTasks(
      [
        task('quick', { priority: Priority.LOW, duration: '0:10' }),
        task('urgent', { priority: Priority.URGENT }),
      ],
      now,
      'UTC',
    );
    expect(ranked[0].task.name).toBe('urgent');
  });
  test('retains long urgent work but labels a partial approach', () => {
    const ranked = rankTasks(
      [
        task('urgent', { priority: Priority.URGENT, duration: '2:00' }),
        task('quick', { priority: Priority.LOW, duration: '0:10' }),
      ],
      now,
      'UTC',
      30,
    );
    expect(ranked[0].task.name).toBe('urgent');
    expect(ranked[0].partial).toBe(true);
  });
  test('supports undated tasks and stable ties without mutating input', () => {
    const tasks = [task('B'), task('A')];
    expect(rankTasks(tasks, now, 'UTC').map((item) => item.task.name)).toEqual([
      'A',
      'B',
    ]);
    expect(tasks.map((item) => item.name)).toEqual(['B', 'A']);
    expect(rankTasks([], now, 'UTC')).toEqual([]);
  });
});
