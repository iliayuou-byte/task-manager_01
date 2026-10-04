import { expect, test } from 'bun:test';
import type { Task } from '../core/types.js';
import { uniqueBrainTasks } from './brainDraft.js';

const task = (name: string): Task => ({ name, completed: false, tags: [] });

test('skips existing and repeated names without changing the source lists', () => {
  const proposed = [task('Study'), task(' study '), task('Shop')];
  const existing = [task('STUDY')];
  expect(uniqueBrainTasks(proposed, existing).map((item) => item.name)).toEqual(
    ['Shop'],
  );
  expect(proposed).toHaveLength(3);
  expect(existing).toHaveLength(1);
});

test('rejects invalid generated fields before a batch can be saved', () => {
  expect(() =>
    uniqueBrainTasks([{ ...task('Study'), duration: 'forty minutes' }], []),
  ).toThrow();
});
