import type { RankedTask } from '../services/priorityEngine.js';

export const getCopilotMessage = (ranked: readonly RankedTask[]): string => {
  const first = ranked[0];
  if (!first) {
    return '📭 Сейчас нет доступных задач. Добавь задачу через /add или посмотри будущие через /list.';
  }
  const title = first.task.name.slice(0, 500);
  const next = ranked
    .slice(1, 3)
    .map((item) => `• ${item.task.name.slice(0, 500)}`)
    .join('\n');
  return [
    `🎯 Сейчас: ${title}`,
    `Почему: ${first.reasons.join('; ')}.`,
    first.partial
      ? 'Начни с одного небольшого шага. Это частичный подход, не обещание закончить задачу.'
      : 'Одно дело за раз. Весь список на плечи не взваливаем.',
    ...(next ? [`На потом:\n${next}`] : []),
    'Отметить готовое: /complete название задачи',
  ].join('\n\n');
};
