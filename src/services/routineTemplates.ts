import { clockMinutes } from './dayPlanner.js';

export interface RoutineBlock {
  name: string;
  start: string;
  end: string;
}
export interface RoutineTemplate {
  id: string;
  name: string;
  blocks: RoutineBlock[];
}
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const parseRoutineBlocks = (text: string): RoutineBlock[] => {
  const lines = text
    .trim()
    .split('\n')
    .filter((line) => line.trim());
  if (!lines.length || lines.length > 24)
    throw new Error('В шаблоне должно быть от 1 до 24 блоков.');
  const blocks = lines.map((line) => {
    const match = line
      .trim()
      .match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\s+(.+)$/);
    if (!match || match[3].length > 120)
      throw new Error('Каждый блок с новой строки: 08:00-08:30 Завтрак.');
    if (clockMinutes(match[1]) === clockMinutes(match[2]))
      throw new Error('Начало и конец блока должны различаться.');
    return { start: match[1], end: match[2], name: match[3].trim() };
  });
  const intervals = blocks
    .flatMap(routineIntervals)
    .sort((a, b) => a.start - b.start);
  if (
    intervals.some(
      (slot, index) => index > 0 && intervals[index - 1].end > slot.start,
    )
  )
    throw new Error(
      'Блоки пересекаются. Исправь время и отправь список ещё раз.',
    );
  return blocks;
};
export const routineIntervals = (block: RoutineBlock) => {
  const start = clockMinutes(block.start);
  const end = clockMinutes(block.end);
  return end > start
    ? [{ start, end }]
    : [
        { start, end: 1440 },
        { start: 0, end },
      ];
};
export const routineText = (template: RoutineTemplate) =>
  template.blocks
    .map((block) => `${block.start}-${block.end} ${block.name}`)
    .join('\n');
export const starterTemplates = (): RoutineTemplate[] => [
  {
    id: 'study',
    name: 'Учебный день',
    blocks: parseRoutineBlocks(
      '07:00-07:30 Подъём и завтрак\n08:00-14:00 Учёба\n14:00-14:30 Обед\n19:00-19:30 Ужин\n22:30-07:00 Сон',
    ),
  },
  {
    id: 'work',
    name: 'Рабочий день',
    blocks: parseRoutineBlocks(
      '07:30-08:00 Подъём и завтрак\n09:00-13:00 Работа\n13:00-14:00 Обед\n14:00-18:00 Работа\n19:00-19:30 Ужин\n23:00-07:30 Сон',
    ),
  },
  {
    id: 'rest',
    name: 'Выходной',
    blocks: parseRoutineBlocks(
      '09:00-09:30 Подъём и завтрак\n13:00-13:30 Обед\n19:00-19:30 Ужин\n23:00-09:00 Сон',
    ),
  },
];
