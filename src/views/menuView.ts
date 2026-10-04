import { InlineKeyboard, Keyboard } from 'grammy';

export const MENU = {
  today: '📋 Сегодня',
  all: '📚 Все дела',
  add: '➕ Добавить',
  now: '🎯 Что сейчас',
  done: '✅ Выполнено',
  remove: '🗑 Удалить',
  settings: '⚙️ Настройки',
  home: '🏠 Меню',
} as const;

export const mainKeyboard = () =>
  new Keyboard()
    .text(MENU.today)
    .text(MENU.all)
    .row()
    .text(MENU.add)
    .text(MENU.now)
    .row()
    .text(MENU.done)
    .text(MENU.remove)
    .row()
    .text(MENU.settings)
    .text(MENU.home)
    .resized()
    .persistent();

export const settingsKeyboard = () =>
  new InlineKeyboard()
    .text('🔔 Напоминания', 'menu:reminders')
    .row()
    .text('🧠 Приоритеты ИИ', 'ai:open')
    .row()
    .text('🌍 Часовой пояс', 'menu:timezone')
    .row()
    .text('🏠 Главное меню', 'menu:home');

export const timeKeyboard = (id: string, hour?: string): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  if (hour === undefined) {
    for (let h = 0; h < 24; h++) {
      const text = String(h).padStart(2, '0');
      keyboard.text(text, `menu:hour:${id}:${text}`);
      if (h % 4 === 3) keyboard.row();
    }
  } else {
    for (const minute of ['00', '15', '30', '45'])
      keyboard.text(`${hour}:${minute}`, `menu:time:${id}:${hour}${minute}`);
    keyboard.row();
  }
  return keyboard
    .text('✏️ Ввести HH:MM', `menu:custom:${id}`)
    .row()
    .text('Назад', 'menu:reminders');
};
