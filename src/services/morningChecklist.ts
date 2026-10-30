import { fromZonedTime } from 'date-fns-tz';
import { InlineKeyboard } from 'grammy';
import type { Metadata } from '../core/types.js';

export const DEFAULT_MORNING_ITEMS = [
  'Завтрак',
  'План на день',
  'Зарядка',
  'Гигиена',
  'Лёгкая медитация',
];

export const morningItems = (metadata: Metadata): string[] => {
  if (!metadata.morning_items) return [...DEFAULT_MORNING_ITEMS];
  try {
    const value: unknown = JSON.parse(metadata.morning_items);
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 8 &&
      value.every(
        (item) =>
          typeof item === 'string' &&
          item.trim().length > 0 &&
          item.length <= 60,
      )
    )
      return value;
  } catch {
    // Ignore invalid stored settings and use the default list.
  }
  return [...DEFAULT_MORNING_ITEMS];
};

export const morningDone = (
  metadata: Metadata,
  itemCount: number,
): number[] => {
  try {
    const value: unknown = JSON.parse(metadata.morning_done || '[]');
    if (Array.isArray(value))
      return [
        ...new Set(
          value.filter(
            (index): index is number =>
              Number.isInteger(index) && index >= 0 && index < itemCount,
          ),
        ),
      ];
  } catch {
    // Invalid progress cannot make the list unusable.
  }
  return [];
};

export const morningExpiry = (date: string, wake: string, timezone: string) =>
  new Date(
    fromZonedTime(`${date}T${wake}:00`, timezone).getTime() + 60 * 60_000,
  );

const oneHourLater = (wake: string) => {
  const minutes = Number(wake.slice(0, 2)) * 60 + Number(wake.slice(3)) + 60;
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

export const morningText = (
  items: string[],
  done: readonly number[],
  wake: string,
  note = '',
) =>
  [
    `☀️ Утро · ${wake}–${oneHourLater(wake)}`,
    '',
    ...items.map(
      (item, index) =>
        `${done.includes(index) ? '✅' : '▫️'} ${index + 1}. ${item}`,
    ),
    '',
    `Готово: ${done.length}/${items.length}. Отмечай пункты кнопками ниже.`,
    ...(note ? ['', note] : []),
  ].join('\n');

export const morningKeyboard = (
  date: string,
  items: string[],
  done: number[],
) => {
  const keyboard = new InlineKeyboard();
  items.forEach((item, index) => {
    keyboard.text(
      `${done.includes(index) ? '✅' : '▫️'} ${index + 1}. ${item.slice(0, 22)}`,
      `morning:${date}:${index}`,
    );
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
};
