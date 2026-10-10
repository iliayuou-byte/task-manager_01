import { expect, test } from 'bun:test';
import {
  exportRoutineTable,
  MAX_ROUTINE_TABLE_BYTES,
  parseRoutineTable,
  readRoutineTable,
} from './routineTable.js';

test('CSV round trips Cyrillic, quoting and spreadsheet formula-like names as text', () => {
  const blocks = [
    { start: '08:00', end: '08:30', name: 'Завтрак, кофе; "дома"' },
    { start: '09:00', end: '10:00', name: '=Проект' },
    { start: '23:00', end: '07:00', name: 'Сон' },
  ];
  const csv = exportRoutineTable(blocks);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain("'=Проект");
  expect(parseRoutineTable(csv)).toEqual(blocks);
  expect(parseRoutineTable('08:00,08:30,"Кофе; чай"')[0].name).toBe(
    'Кофе; чай',
  );
});
test('copied tables and locale CSV support reordered headers, extra Notion columns and clocks', () => {
  expect(
    parseRoutineTable(
      'Занятие\tКонец\tНачало\tКомментарий\nЗавтрак\t08:30:00\t8:00\tЗаметка',
    ),
  ).toEqual([{ start: '08:00', end: '08:30', name: 'Завтрак' }]);
  expect(
    parseRoutineTable('Start;End;Activity\r\n8:00;08:30;Завтрак'),
  ).toHaveLength(1);
  expect(parseRoutineTable('8:00\t08:30\tЗавтрак')).toHaveLength(1);
});
test('invalid or oversized imports fail without silently dropping blocks', () => {
  for (const value of [
    '',
    'Начало,Занятие\n08:00,Еда',
    '08:00,08:30',
    '08:00,09:00,"Еда',
    '08:00,09:00,"Еда"ошибка',
    '08:00,09:00,"Еда\nЕщё еда"',
    '08:00,09:00,Еда\n08:30,10:00,Работа',
    'a'.repeat(MAX_ROUTINE_TABLE_BYTES + 1),
  ])
    expect(() => parseRoutineTable(value)).toThrow();
});
test('download validates UTF-8, HTTP status and actual streamed size', async () => {
  expect(await readRoutineTable(new Response('Начало,Конец,Занятие'))).toBe(
    'Начало,Конец,Занятие',
  );
  await expect(
    readRoutineTable(new Response(null, { status: 403 })),
  ).rejects.toThrow();
  await expect(
    readRoutineTable(new Response(new Uint8Array([255]))),
  ).rejects.toThrow('UTF-8');
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_ROUTINE_TABLE_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readRoutineTable(new Response(stream))).rejects.toThrow('64 КБ');
  expect(cancelled).toBe(true);
});
