import type { Task } from '../core/types.js';
import { getQuadrant } from '../services/eisenhower.js';

export const SECTION_TITLES = [
  '🔴 Важно и срочно',
  '🟡 Важно, не срочно',
  '🔵 Неважно, но срочно',
  '⚪ Неважно и не срочно',
] as const;

export const HOME_TEXT =
  '♠️ <b>Шестёрка</b>\nТвой список. Моя суета.\n\nКидай дела текстом или голосом — разложим по полкам.\nА если список давит, выберем один следующий шаг.';
export const SETTINGS_TEXT =
  '⚙️ <b>Подкрутить шестёрку</b>\n\nКогда напоминать, как расставлять приоритеты и по какому времени жить — выбирай ниже.';
export const ADD_TEXT =
  '➕ <b>Выгружай из головы</b>\n\nНапиши дела одним сообщением или отправь ГС.\nМожно сумбурно — сначала покажу черновик.\n\nЕсть срок? Скажи «до завтра» или «до выхода из дома». Мысли я пока не читаю.';

export const htmlText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const taskCardText = (task: Task): string =>
  [
    `📌 <b>${htmlText(task.name)}</b>`,
    '',
    SECTION_TITLES[getQuadrant(task) - 1],
    task.date || task.time
      ? `🗓 ${htmlText([task.date, task.time].filter(Boolean).join(' · '))}`
      : '🗓 Без срока',
    ...(task.duration ? [`⏱ ${htmlText(task.duration)} ч`] : []),
    ...(task.tags.length
      ? [`🏷 ${htmlText(task.tags.map((tag) => `#${tag}`).join(' '))}`]
      : []),
    ...(task.description ? ['', htmlText(task.description.slice(0, 500))] : []),
    '',
    task.priorityLocked
      ? '🔒 Категория за тобой. ИИ не трогает.'
      : '🧠 ИИ предлагает. Последнее слово — твоё.',
  ].join('\n');
