import type { Task } from '../core/types.js';
import { getQuadrant, QUADRANTS } from '../services/eisenhower.js';

export const matrixLines = (tasks: readonly Task[]): string[] => {
  let number = 0;
  return QUADRANTS.flatMap((title, index) => {
    const group = tasks.filter((task) => getQuadrant(task) === index + 1);
    return [
      `-------- ${title} --------`,
      ...(!group.length
        ? ['Пока пусто']
        : group.map((task) => {
            const details = [
              task.date,
              task.time,
              task.duration && `${task.duration} ч`,
            ]
              .filter(Boolean)
              .join(' · ');
            return `${++number}. ${task.completed ? '✅ ' : ''}${task.name.replace(/\s+/g, ' ').slice(0, 250)}${details ? ` (${details})` : ''}`;
          })),
      '',
    ];
  });
};

export const splitMessages = (lines: readonly string[]): string[] => {
  const messages: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 1 > 3800) {
      messages.push(current.trimEnd());
      current = '';
    }
    current += `${line}\n`;
  }
  if (current.trim()) messages.push(current.trimEnd());
  return messages;
};
