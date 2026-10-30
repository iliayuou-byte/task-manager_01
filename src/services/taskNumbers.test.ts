import { expect, test } from 'bun:test';
import type { Task } from '../core/types.js';
import { setQuadrant } from './eisenhower.js';
import {
  getNumberedTasks,
  numberedTasks,
  parseTaskNumbers,
  rememberTaskNumbers,
  removeSelectedTasks,
} from './taskNumbers.js';

const task = (name: string): Task => ({ name, completed: false, tags: [] });

test('numbers follow the displayed quadrant order and snapshots do not mutate', () => {
  const tasks = [
    setQuadrant(task('later'), 4),
    setQuadrant(task('now'), 1),
    setQuadrant(task('study'), 2),
  ];
  expect(numberedTasks(tasks).map((item) => item.name)).toEqual([
    'now',
    'study',
    'later',
  ]);
  rememberTaskNumbers(1, 1, tasks);
  tasks[1].name = 'changed';
  expect(getNumberedTasks(1, 1)?.[0].name).toBe('now');
  expect(getNumberedTasks(2, 1)).toBeUndefined();
});

test('numeric selection supports multiple tasks and rejects invalid indices', () => {
  expect(parseTaskNumbers('1, 3 3')).toEqual([1, 3]);
  expect(() => parseTaskNumbers('0')).toThrow();
  expect(() => parseTaskNumbers('-1')).toThrow();
  expect(() => parseTaskNumbers('1 foo')).toThrow();
});

test('reordered live tasks cannot change the deletion target', () => {
  const a = task('A');
  const b = task('B');
  const data = { completed: [], uncompleted: [b, a] };
  expect(
    removeSelectedTasks(data, [a]).uncompleted.map((item) => item.name),
  ).toEqual(['B']);
  expect(data.uncompleted).toHaveLength(2);
});

test('stale and ambiguous targets abort the entire batch', () => {
  const a = task('A');
  expect(() =>
    removeSelectedTasks(
      { completed: [], uncompleted: [{ ...a, completed: true }] },
      [a],
    ),
  ).toThrow();
  expect(() =>
    removeSelectedTasks({ completed: [], uncompleted: [a, a] }, [a]),
  ).toThrow();
  expect(() =>
    removeSelectedTasks({ completed: [], uncompleted: [task('B')] }, [a]),
  ).toThrow();
});
