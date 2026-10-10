import type { Task } from '../core/types.js';
import { validateTask } from '../utils/validators.js';

export const uniqueBrainTasks = (
  proposed: readonly Task[],
  existing: readonly Task[],
): Task[] => {
  const names = new Set(existing.map((task) => task.name.trim().toLowerCase()));
  const result: Task[] = [];
  for (const task of proposed) {
    if (!validateTask(task).valid)
      throw new Error('AI returned invalid task fields');
    const key = task.name.trim().toLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    result.push(task);
  }
  return result;
};
