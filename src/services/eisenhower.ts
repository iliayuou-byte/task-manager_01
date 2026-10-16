import { Priority, type Task } from '../core/types.js';

export const QUADRANTS = [
  'Важно и срочно — сделать первым',
  'Важно, не срочно — запланировать',
  'Не очень важно, но срочно — упростить / делегировать',
  'Не важно и не срочно — отложить / убрать',
] as const;

export const getQuadrant = (task: Task): number => {
  const important = task.important ?? task.priority !== Priority.LOW;
  const urgent = task.urgent ?? task.priority === Priority.URGENT;
  return important ? (urgent ? 1 : 2) : urgent ? 3 : 4;
};

export const setQuadrant = (task: Task, quadrant: number): Task => ({
  ...task,
  priorityLocked: true,
  important: quadrant === 1 || quadrant === 2,
  urgent: quadrant === 1 || quadrant === 3,
});
