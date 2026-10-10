import {
  parseRoutineBlocks,
  type RoutineBlock,
  WEEKDAYS,
} from './routineTemplates.js';

export const MAX_ROUTINE_TABLE_BYTES = 64 * 1024;
const HEADER_ALIASES = {
  template: ['шаблон', 'template', 'regime'],
  days: ['дни', 'дни недели', 'weekdays', 'days'],
  start: ['начало', 'start'],
  end: ['конец', 'end'],
  name: ['занятие', 'название', 'name', 'activity'],
};
export interface RoutineWorkbook {
  templates: Array<{ name: string; days: number[]; blocks: RoutineBlock[] }>;
}
const parseCells = (text: string, separator: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === separator || char === '\n') {
      row.push(cell.trim());
      cell = '';
      closed = false;
      if (char === '\n') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closed && char.trim()) throw new Error('Некорректные кавычки в CSV.');
      cell += char;
    }
  }
  if (quoted) throw new Error('В CSV не закрыты кавычки.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};
const normalizeClock = (value: string) =>
  value
    .trim()
    .replace(/^(\d):/, '0$1:')
    .replace(/^(\d{2}:\d{2}):00$/, '$1');
export const parseRoutineWorkbook = (source: string): RoutineWorkbook => {
  if (Buffer.byteLength(source, 'utf8') > MAX_ROUTINE_TABLE_BYTES)
    throw new Error('Таблица должна быть не больше 64 КБ.');
  const text = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  const firstLine = text.split('\n')[0] || '';
  let separator = ',';
  let quoted = false;
  for (let index = 0; index < firstLine.length; index++) {
    const char = firstLine[index];
    if (char === '"') {
      if (quoted && firstLine[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && [',', ';', '\t'].includes(char)) {
      separator = char;
      break;
    }
  }
  const rows = parseCells(text, separator);
  if (!rows.length) throw new Error('Таблица пустая.');
  const header = rows[0].map((cell) => cell.toLowerCase());
  const fields = Object.entries(HEADER_ALIASES).map(
    ([field, aliases]) =>
      [field, header.findIndex((cell) => aliases.includes(cell))] as const,
  );
  const namedFormat = fields.some(([, index]) => index >= 0);
  const indexes = Object.fromEntries(fields) as Record<string, number>;
  const legacyFormat =
    namedFormat &&
    indexes.template < 0 &&
    indexes.days < 0 &&
    indexes.start >= 0 &&
    indexes.end >= 0 &&
    indexes.name >= 0;
  if (namedFormat && !legacyFormat) {
    if (
      ['template', 'days', 'start', 'end', 'name'].some(
        (field) => indexes[field] < 0,
      )
    )
      throw new Error('Нужны колонки: Шаблон, Дни, Начало, Конец, Занятие.');
    rows.shift();
  } else if (legacyFormat) {
    rows.shift();
    indexes.template = -1;
    indexes.days = -1;
  } else {
    indexes.template = -1;
    indexes.days = -1;
    indexes.start = 0;
    indexes.end = 1;
    indexes.name = 2;
  }
  if (!rows.length || rows.length > 300)
    throw new Error('Добавь от 1 до 300 строк расписания.');
  const groups = new Map<
    string,
    { name: string; days: number[]; blocks: RoutineBlock[] }
  >();
  for (const row of rows) {
    if (Object.values(indexes).some((index) => index >= row.length))
      throw new Error('В строке не хватает колонок.');
    const name =
      indexes.template < 0
        ? 'Режим'
        : row[indexes.template].replace(/^'(?=[=+@-])/, '').trim();
    if (!name || name.length > 80)
      throw new Error(
        'У каждой строки укажи название шаблона (до 80 символов).',
      );
    const dayText = indexes.days < 0 ? '' : row[indexes.days].trim();
    const days = dayText
      ? dayText
          .split(/[|, ]+/)
          .filter(Boolean)
          .map((label) => {
            const day = WEEKDAYS.findIndex(
              (value) => value.toLowerCase() === label.toLowerCase(),
            );
            if (day < 0)
              throw new Error(
                `Не знаю день «${label}». Используй Пн|Вт|Ср|Чт|Пт|Сб|Вс.`,
              );
            return day + 1;
          })
      : [];
    if (new Set(days).size !== days.length)
      throw new Error(`День повторяется в шаблоне «${name}».`);
    const key = name.toLocaleLowerCase('ru');
    const previous = groups.get(key);
    if (
      previous &&
      (previous.name !== name || previous.days.join(',') !== days.join(','))
    )
      throw new Error(
        `В строках шаблона «${name}» название и дни должны совпадать.`,
      );
    const start = normalizeClock(row[indexes.start]);
    const end = normalizeClock(row[indexes.end]);
    const activity = row[indexes.name].replace(/^'(?=[=+@-])/, '').trim();
    if (/[\n\r]/.test(activity))
      throw new Error('Название занятия должно быть одной строкой.');
    const group = previous || { name, days, blocks: [] };
    group.blocks.push(...parseRoutineBlocks(`${start}-${end} ${activity}`));
    groups.set(key, group);
  }
  if (groups.size > 12) throw new Error('Можно сохранить до 12 шаблонов.');
  const result = [...groups.values()].map((group) => ({
    ...group,
    blocks: parseRoutineBlocks(
      group.blocks
        .map((block) => `${block.start}-${block.end} ${block.name}`)
        .join('\n'),
    ),
  }));
  if ((!namedFormat || legacyFormat) && result.length !== 1)
    throw new Error('Файл должен содержать заголовки Шаблон и Дни.');
  const assigned = new Set<number>();
  for (const template of result)
    for (const day of template.days) {
      if (assigned.has(day))
        throw new Error(`${WEEKDAYS[day - 1]} назначен сразу двум шаблонам.`);
      assigned.add(day);
    }
  return { templates: result };
};
export const parseRoutineTable = (source: string): RoutineBlock[] =>
  parseRoutineWorkbook(source).templates.flatMap((template) => template.blocks);
export const exportRoutineTable = (
  blocks: RoutineBlock[],
  separator: ',' | ';' = ',',
): string =>
  exportRoutineWorkbook(
    { templates: [{ name: 'Режим', days: [], blocks }] },
    separator,
  );
export const exportRoutineWorkbook = (
  workbook: RoutineWorkbook,
  separator: ',' | ';' = ',',
): string => {
  const quote = (value: string) =>
    `"${(/^[=+@-]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [
      ['Шаблон', 'Дни', 'Начало', 'Конец', 'Занятие'],
      ...workbook.templates.flatMap((template) =>
        template.blocks.map((block) => [
          template.name,
          template.days.map((day) => WEEKDAYS[day - 1]).join('|'),
          block.start,
          block.end,
          block.name,
        ]),
      ),
    ]
      .map((row) => row.map(quote).join(separator))
      .join('\r\n')
  );
};
export const readRoutineTable = async (response: Response): Promise<string> => {
  if (!response.ok || !response.body)
    throw new Error('Не удалось скачать CSV. Отправь файл ещё раз.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_ROUTINE_TABLE_BYTES) {
        await reader.cancel();
        throw new Error('Таблица должна быть не больше 64 КБ.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Сохрани таблицу как CSV UTF-8 и отправь ещё раз.');
  }
};
