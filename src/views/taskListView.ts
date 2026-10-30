import { InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import type { nearestCalendarClass } from '../services/personalDashboard.js';
import { htmlText } from './botStyle.js';
import { MENU } from './menuView.js';

export const taskListScreen = (screen: {
  tasks: Task[];
  id: string;
  page: number;
  today: boolean;
  date: string;
  completedToday: number;
  nextClass: ReturnType<typeof nearestCalendarClass>;
}) => {
  const { tasks, id, page, date, nextClass } = screen;
  const visible = tasks.slice(page * 6, page * 6 + 6);
  const title = (task: Task) => task.name.replace(/\s+/g, ' ');
  const lines = [
    `📋 <b>${screen.today ? 'Сегодня' : 'Все дела'}</b> · ${date}`,
    `✅ Сегодня выполнено: ${screen.completedToday} · В списке: ${tasks.length}`,
    ...(screen.today ? ['Без даты, просроченные и сегодняшние дела.'] : []),
    '',
    ...(nextClass
      ? [
          `📚 ${nextClass.current ? 'Сейчас пара' : 'Ближайшая пара'} · ${nextClass.date === date ? 'сегодня' : nextClass.date}`,
          `${nextClass.time}–${nextClass.endTime} · ${htmlText(nextClass.title)}`,
          '',
        ]
      : []),
    ...(visible.length
      ? visible.map(
          (task, i) =>
            `${page * 6 + i + 1}. ${htmlText(title(task).slice(0, 200))}${task.date ? ` · ${htmlText(task.date)}` : ''}${task.time ? ` ${htmlText(task.time)}` : ''}`,
        )
      : ['Здесь пока нет дел. Добавь новое или открой другой список.']),
    '',
    '☐ — завершить · ✏️ — изменить · название — открыть.',
  ];
  const keyboard = new InlineKeyboard();
  visible.forEach((task, i) => {
    const index = page * 6 + i;
    keyboard
      .text('☐', `menu:rowdone:${id}:${index}`)
      .text(
        `${index + 1}. ${title(task).slice(0, 28)}`,
        `menu:task:${id}:${index}`,
      )
      .text('✏️', `menu:rowedit:${id}:${index}`)
      .row();
  });
  if (page) keyboard.text('◀️', `menu:page:${id}:${page - 1}`);
  if ((page + 1) * 6 < tasks.length)
    keyboard.text('▶️', `menu:page:${id}:${page + 1}`);
  keyboard
    .row()
    .text(MENU.add, 'menu:add')
    .text(MENU.calendar, 'menu:calendar')
    .row()
    .text(
      screen.today ? MENU.all : MENU.today,
      screen.today ? 'menu:filterall' : 'menu:filtertoday',
    )
    .text(MENU.personal, 'pui:home')
    .row()
    .text(MENU.settings, 'menu:settings');
  return { text: lines.join('\n'), keyboard };
};
