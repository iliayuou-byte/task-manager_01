import { parseRoutineBlocks, type RoutineBlock } from './routineTemplates.js';

export const MAX_ROUTINE_TABLE_BYTES = 64 * 1024;
const HEADER_ALIASES = [
  ['начало', 'start'],
  ['конец', 'end'],
  ['занятие', 'название', 'name', 'activity'],
];
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
export const parseRoutineTable = (source: string): RoutineBlock[] => {
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
  let columns = HEADER_ALIASES.map((aliases) =>
    header.findIndex((cell) => aliases.includes(cell)),
  );
  if (columns.some((index) => index !== -1)) {
    if (columns.includes(-1))
      throw new Error('Нужны колонки: Начало, Конец, Занятие.');
    rows.shift();
  } else columns = [0, 1, 2];
  const blocks = rows.map((row) => {
    if (columns.some((index) => index >= row.length))
      throw new Error('В строке не хватает колонок.');
    const start = normalizeClock(row[columns[0]]);
    const end = normalizeClock(row[columns[1]]);
    const name = row[columns[2]].replace(/^'(?=[=+@-])/, '');
    if (/[\n\r]/.test(name))
      throw new Error('Название занятия должно быть одной строкой.');
    return `${start}-${end} ${name}`;
  });
  return parseRoutineBlocks(blocks.join('\n'));
};
export const exportRoutineTable = (blocks: RoutineBlock[]): string => {
  const quote = (value: string) =>
    `"${(/^[=+@-]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [
      ['Начало', 'Конец', 'Занятие'],
      ...blocks.map((block) => [block.start, block.end, block.name]),
    ]
      .map((row) => row.map(quote).join(','))
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
