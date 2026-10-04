import { formatInTimeZone } from 'date-fns-tz';
import { Priority, type Task } from '../core/types.js';

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
  const weights = {
    [Priority.LOW]: 10,
    [Priority.MEDIUM]: 30,
    [Priority.HIGH]: 60,
    [Priority.URGENT]: 90,
  };

  return (
    tasks
      .filter((task) => !task.completed)
      // Dated tasks are planned dates, not inferred deadlines.
      .filter((task) => !task.date || task.date <= today)
      .filter(
        (task) => !(task.date === today && task.time && task.time > clock),
      )
      .map((task): RankedTask => {
        let score = weights[task.priority ?? Priority.MEDIUM];
        const reasons: string[] = [];
        if (task.priority === Priority.URGENT)
          reasons.push('срочный приоритет');
        if (task.priority === Priority.HIGH) reasons.push('высокий приоритет');
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
        (a, b) => b.score - a.score || a.task.name.localeCompare(b.task.name),
      )
  );
};
