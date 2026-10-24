import { createHash } from 'node:crypto';
import type { Task, TaskData } from '../core/types.js';
import { getQuadrant } from './eisenhower.js';

export const taskFingerprint = (task: Task): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(task)
          .filter(([, value]) => value !== undefined && value !== '')
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex');

export const numberedTasks = (tasks: readonly Task[]): Task[] =>
  [1, 2, 3, 4].flatMap((q) => tasks.filter((task) => getQuadrant(task) === q));

const lists = new Map<string, { tasks: Task[]; expires: number }>();
const key = (user: number, chat: number) => `${user}:${chat}`;
export const rememberTaskNumbers = (
  user: number,
  chat: number,
  tasks: readonly Task[],
) => {
  for (const [id, list] of lists)
    if (list.expires < Date.now()) lists.delete(id);
  lists.set(key(user, chat), {
    tasks: structuredClone(numberedTasks(tasks)),
    expires: Date.now() + 24 * 60 * 60_000,
  });
};
export const getNumberedTasks = (
  user: number,
  chat: number,
): Task[] | undefined => {
  const list = lists.get(key(user, chat));
  return list && list.expires > Date.now()
    ? structuredClone(list.tasks)
    : undefined;
};

export const parseTaskNumbers = (input: string): number[] => {
  if (!/^\d+(?:[\s,]+\d+)*$/.test(input.trim()))
    throw new Error('Invalid task numbers');
  const values = [
    ...new Set(
      input
        .trim()
        .split(/[\s,]+/)
        .map(Number),
    ),
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 1))
    throw new Error('Invalid task numbers');
  return values;
};

export const removeSelectedTasks = (
  data: TaskData,
  selected: readonly Task[],
): TaskData => {
  const all = [...data.uncompleted, ...data.completed];
  const fingerprints = new Set(selected.map(taskFingerprint));
  for (const fingerprint of fingerprints) {
    if (
      all.filter((task) => taskFingerprint(task) === fingerprint).length !== 1
    ) {
      throw new Error('Selected tasks have changed or are ambiguous');
    }
  }
  return {
    uncompleted: data.uncompleted.filter(
      (task) => !fingerprints.has(taskFingerprint(task)),
    ),
    completed: data.completed.filter(
      (task) => !fingerprints.has(taskFingerprint(task)),
    ),
  };
};
