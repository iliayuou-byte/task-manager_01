import type { Task } from '../core/types.js';
import { getQuadrant } from '../services/eisenhower.js';

import { displayTaskTags } from '../services/taskTags.js';
import { SECTION_TITLES } from './botStyle.js';

export const matrixLines = (tasks: readonly Task[]): string[] => {
  let number = 0;
  return SECTION_TITLES.flatMap((title, index) => {
    const group = tasks.filter((task) => getQuadrant(task) === index + 1);
    return [
      `${title} · ${group.length}`,
      ...(!group.length
        ? ['— пока пусто']
        : group.map((task) => {
            const details = [
              task.date,
              task.time,
              task.duration && `${task.duration} ч`,
            ]
              .filter(Boolean)
              .join(' · ');
            return `${++number}. ${task.completed ? '✅ ' : ''}${task.name.replace(/\s+/g, ' ').slice(0, 250)}${details ? ` (${details})` : ''}${displayTaskTags(task.tags)}`;
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
