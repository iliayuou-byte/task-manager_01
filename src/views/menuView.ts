import { InlineKeyboard } from 'grammy';

export const MENU = {
  personal: '🧭 Мой день',
  today: '📋 Сегодня',
  plan: '📅 План на сегодня',
  calendar: '📅 Календарь',
  all: '📚 Все дела',
  add: '➕ Добавить',
  now: '🎯 Что сейчас',
  done: '✅ Выполнено',
  remove: '🗑 Удалить',
  settings: '⚙️ Настройки',
  // Recognition only: older reply keyboards still send this label.
  retiredChat: '💬 Поговорить',
  home: '🏠 Меню',
  back: '⬅️ Назад',
} as const;

export const mainInlineKeyboard = (personal = false) => {
  const keyboard = new InlineKeyboard();
  if (personal)
    return keyboard
      .text(MENU.personal, 'pui:home')
      .text(MENU.all, 'menu:all')
      .row()
      .text(MENU.add, 'menu:add')
      .text(MENU.calendar, 'menu:calendar')
      .row()
      .text(MENU.settings, 'menu:settings');
  return keyboard
    .text(MENU.today, 'menu:today')
    .text(MENU.all, 'menu:all')
    .row()
    .text(MENU.add, 'menu:add')
    .text(MENU.now, 'menu:now')
    .row()
    .text(MENU.settings, 'menu:settings')
    .row()
    .text(MENU.plan, 'menu:calendar:today');
};

export const settingsKeyboard = (personal = false) => {
  const keyboard = new InlineKeyboard();
  if (personal)
    keyboard
      .text('🔔 Мой режим', 'pui:settings')
      .text('🔔 Дневные сводки', 'menu:reminders')
      .row();
  else
    keyboard
      .text('🔔 Напоминания', 'menu:reminders')
      .row()
      .text('⏰ Режим подъёма', 'menu:wake')
      .row()
      .text('☀️ Утренний список', 'menu:morning')
      .row();
  return keyboard
    .text('📺 Утренний телевизор', 'menu:tv')
    .row()
    .text('🧠 Приоритеты ИИ', 'ai:open')
    .row()
    .text('🌍 Часовой пояс', 'menu:timezone')
    .row()
    .text('⬅️ Назад', 'menu:home')
    .text('🏠 Меню', 'menu:home');
};

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
    .text('⬅️ Назад', hour === undefined ? 'menu:reminders' : `menu:hours:${id}`)
    .text('🏠 Меню', 'menu:home');
};

export const navigationKeyboard = (back = 'menu:back') =>
  new InlineKeyboard().text('⬅️ Назад', back).text('🏠 Меню', 'menu:home');
