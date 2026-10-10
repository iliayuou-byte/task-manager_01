import { formatInTimeZone } from 'date-fns-tz';
import type { Task } from '../core/types.js';
import { getQuadrant, QUADRANTS } from './eisenhower.js';

export interface RankedTask {
  task: Task;
  score: number;
  reasons: string[];
  partial: boolean;
}

export const rankTasks = (
  tasks: readonly Task[],
  now: Date,
  timezone: string,
  availableMinutes?: number,
): RankedTask[] => {
  const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');
  const clock = formatInTimeZone(now, timezone, 'HH:mm');
  return (
    tasks
      .filter((task) => !task.completed)
      // Dated tasks are planned dates, not inferred deadlines.
      .filter((task) => !task.date || task.date <= today)
      .filter(
        (task) => !(task.date === today && task.time && task.time > clock),
      )
      .map((task): RankedTask => {
        const quadrant = getQuadrant(task);
        let score = [100, 60, 30, 10][quadrant - 1];
        const reasons: string[] = [QUADRANTS[quadrant - 1]];
        if (task.date && task.date < today) {
          score += 40;
          reasons.push('запланированная дата уже прошла');
        } else if (task.date === today) {
          score += 25;
          reasons.push('запланировано на сегодня');
        }
        const duration = task.duration?.match(/^(\d+):([0-5]\d)$/);
        const minutes = duration
          ? Number(duration[1]) * 60 + Number(duration[2])
          : undefined;
        const partial =
          availableMinutes !== undefined &&
          minutes !== undefined &&
          minutes > availableMinutes;
        if (partial) {
          score -= 20;
          reasons.push('целиком не помещается в доступное время');
        } else if (minutes !== undefined && minutes > 0 && minutes <= 30) {
          score += 5;
          reasons.push('короткая задача');
        }
        if (reasons.length === 0)
          reasons.push('приоритет среди доступных задач');
        return { task, score, reasons, partial };
      })
      .sort(
        (a, b) =>
          getQuadrant(a.task) - getQuadrant(b.task) ||
          b.score - a.score ||
          a.task.name.localeCompare(b.task.name),
      )
  );
};
