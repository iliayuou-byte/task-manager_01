import { InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import type { DayPlan, PersonalState } from '../services/personal.js';
import { MENU } from './menuView.js';
import { AREA_LABELS } from './personalView.js';

export const PERSONAL_TIME_LABELS = {
  morning: 'Утренний план и подъём',
  evening: 'Вечерний обзор',
  bedtime: 'Подготовка ко сну',
  quietStart: 'Начало тихих часов',
  quietEnd: 'Конец тихих часов',
};

export const PERSONAL_BUTTON_TEXT = {
  timeFormat: 'Введи время как 08:30.',
  closedDraft: 'Этот шаг уже закрыт. Открой «Мой день» заново.',
  reviewDayChanged: 'Наступил другой день. Начни обзор заново.',
  stepDayChanged: 'Наступил другой день. Начни первый шаг заново.',
  reviewSaved: 'Обзор сохранён. Первый шаг появится в завтрашнем плане.',
  customTimePrompt: 'Отправь время одним сообщением, например 08:30.',
  dayModePrompt: 'Какой сейчас день?',
  stepPrompt: 'Какой первый шаг поможет начать? Напиши до 400 символов.',
  morningItemsPrompt:
    'Напиши от 1 до 8 утренних пунктов, каждый с новой строки, до 60 символов. Изменения — со следующего утра.',
  leadPrompt:
    'За сколько минут напоминать о задаче или паре? Отправь число от 1 до 180.',
  oldWakeSignal: 'Это сигнал другого дня. Открой сегодняшнее утро.',
  oldChecklist: 'Этот список относится к другому дню. Открой сегодняшнее утро.',
  captureLength: 'Напиши название от 1 до 500 символов.',
  reviewLength: 'Напиши от 1 до 400 символов.',
  stepLength: 'Первый шаг — от 1 до 400 символов.',
  morningItemsLength: 'Нужно 1–8 пунктов, каждый до 60 символов.',
  leadRange: 'Введи целое число от 1 до 180.',
  reviewEnergyPrompt:
    '🌙 Вечерний обзор\n\nСколько сил было сегодня?\n1 — совсем мало, 5 — много.',
};

export const personalHomeMessage = (date: string) =>
  `🧭 Мой день · ${date}\n\nВыбери до трёх результатов, сверяйся с парами и возвращайся к маленькому шагу, когда тяжело начать.`;

export const personalHomeKeyboard = () =>
  new InlineKeyboard()
    .text('☀️ План дня', 'pui:plan')
    .text('🎯 Три приоритета', 'pui:focus')
    .row()
    .text('🌅 Моё утро', 'pui:checklist')
    .text('🌙 Вечерний обзор', 'pui:evening')
    .row()
    .text('📚 Учёба', 'pui:study')
    .text('🏋️ Зал', 'pui:gym')
    .row()
    .text('📥 Входящие', 'pui:inbox')
    .text('🔔 Мой режим', 'pui:settings')
    .row()
    .text(MENU.now, 'menu:now')
    .row()
    .text('🏠 Меню', 'menu:home');

export const personalTasksMessage = (
  list: Task[],
  offset: number,
  area?: 'study' | 'gym',
) => {
  const title = area ? AREA_LABELS[area] : 'Входящие';
  return `${title} · ${list.length} дел\n\n${
    list.length
      ? list
          .slice(offset, offset + 6)
          .map(
            (task) =>
              `○ ${task.name}${task.date ? ` · ${task.date}${task.time ? ` ${task.time}` : ''}` : ''}`,
          )
          .join('\n')
      : 'Пока пусто. Добавь первый небольшой шаг.'
  }\n\nВ карточке можно назначить дату и время, изменить или завершить дело.`;
};

export const personalTasksKeyboard = (
  list: Task[],
  offset: number,
  area?: 'study' | 'gym',
) => {
  const keyboard = new InlineKeyboard()
    .text('➕ Добавить', `pui:add:${area ?? 'inbox'}`)
    .row();
  for (const task of list.slice(offset, offset + 6))
    keyboard.text(task.name.slice(0, 40), `pui:task:${task.id}`).row();
  if (offset)
    keyboard.text('◀️', `pui:list:${area ?? 'inbox'}:${offset / 6 - 1}`);
  if (offset + 6 < list.length)
    keyboard.text('▶️', `pui:list:${area ?? 'inbox'}:${offset / 6 + 1}`);
  return keyboard
    .row()
    .text('🎯 Выбрать на сегодня', 'pui:focus')
    .row()
    .text('⬅️ Назад', 'pui:home')
    .text('🏠 Меню', 'menu:home');
};

type MorningChecklist = Pick<DayPlan, 'morningItems' | 'morningDone'>;

export const personalChecklistMessage = (date: string, day: MorningChecklist) =>
  `🌅 Запуск утра · ${date}\n\n${day.morningItems.map((item, i) => `${day.morningDone.includes(i) ? '✅' : '▫️'} ${item}`).join('\n')}\n\nГотово: ${day.morningDone.length}/${day.morningItems.length}. Можно начать с одного пункта.`;

export const personalChecklistKeyboard = (
  date: string,
  day: MorningChecklist,
) => {
  const keyboard = new InlineKeyboard();
  day.morningItems.forEach((item, i) => {
    keyboard
      .text(
        `${day.morningDone.includes(i) ? '✅' : '▫️'} ${item}`,
        `pui:check:${date}:${i}`,
      )
      .row();
  });
  return keyboard
    .text('📋 План дня', 'pui:plan')
    .row()
    .text('⬅️ Назад', 'pui:home')
    .text('🏠 Меню', 'menu:home');
};

type PersonalReminders = PersonalState['reminders'];

export const personalSettingsMessage = (
  s: PersonalReminders,
  timezone: string,
) =>
  `🔔 Мой режим · ${s.enabled ? 'сигналы включены' : 'сигналы выключены'}\n\nПодъём и план: ${s.morning}${s.wakeRepeats ? ', ещё через 5 и 10 минут до «Я встал»' : ''}\nВечерний обзор: ${s.evening}\nПодготовка ко сну: ${s.bedtime ?? 'выключена'}\nТихие часы: ${s.quietStart}–${s.quietEnd}\nЗа ${s.leadMinutes} мин до задачи или пары\nНедельный итог: ${s.weekly}, день ${s.weeklyDay} (0 — воскресенье)\nЧасовой пояс: ${timezone}\n\nКомпьютер и бот должны работать для доставки Telegram. Дневные сводки со списком дел настраиваются отдельно.${s.routine ? '\nНовый распорядок заменяет прежний сигнал подъёма; настройка телевизора сохраняется.' : '\nПрежний подъём ещё действует отдельно: его настройки — на последней странице. Для перехода открой «Настроить мой распорядок» и проверь предлагаемые значения перед применением.'}`;

export const personalSettingsKeyboard = (s: PersonalReminders) => {
  const keyboard = new InlineKeyboard()
    .text('✨ Настроить мой распорядок', 'pui:preset')
    .row()
    .text(
      s.enabled ? '🔕 Выключить личные сигналы' : '🔔 Включить личные сигналы',
      `pui:enabled:${s.enabled ? 'off' : 'on'}`,
    )
    .row()
    .text(`☀️ Подъём ${s.morning}`, 'pui:timefield:morning')
    .row()
    .text(
      s.wakeRepeats
        ? 'Повторы подъёма: включены'
        : 'Повторы подъёма: выключены',
      `pui:repeat:${s.wakeRepeats ? 'off' : 'on'}`,
    )
    .row()
    .text(`🌙 Обзор ${s.evening}`, 'pui:timefield:evening')
    .row()
    .text(`🛌 Ко сну ${s.bedtime ?? 'выкл.'}`, 'pui:timefield:bedtime')
    .row()
    .text(`🤫 Тишина с ${s.quietStart}`, 'pui:timefield:quietStart')
    .row()
    .text(`🤫 Тишина до ${s.quietEnd}`, 'pui:timefield:quietEnd')
    .row()
    .text(`📅 До события ${s.leadMinutes} мин`, 'pui:lead')
    .row()
    .text('📝 Изменить утренние пункты', 'pui:items')
    .row()
    .text('📊 Итоги недели', 'pui:week')
    .row()
    .text('🔔 Дневные сводки', 'menu:reminders')
    .row();
  if (!s.routine)
    keyboard
      .text('⏰ Прежний подъём', 'menu:wake')
      .text('☀️ Прежний список', 'menu:morning')
      .row();
  return keyboard.text('⬅️ Назад', 'pui:home').text('🏠 Меню', 'menu:home');
};

export const personalTimePickerMessage = (
  field: keyof typeof PERSONAL_TIME_LABELS,
  hour?: string,
) =>
  `${PERSONAL_TIME_LABELS[field]}\n${hour === undefined ? 'Выбери час.' : 'Выбери минуты.'}`;

export const personalTimePickerKeyboard = (id: string, hour?: string) => {
  const keyboard = new InlineKeyboard();
  if (hour === undefined) {
    for (let h = 0; h < 24; h++)
      keyboard.text(String(h).padStart(2, '0'), `pui:hour:${id}:${h}`).row();
  } else {
    for (const minute of ['00', '15', '30', '45'])
      keyboard.text(`${hour}:${minute}`, `pui:minute:${id}:${minute}`).row();
  }
  return keyboard
    .text('✏️ Ввести HH:MM', `pui:custom:${id}`)
    .row()
    .text('⬅️ Назад', hour === undefined ? 'pui:settings' : `pui:hours:${id}`)
    .text('🏠 Меню', 'menu:home');
};

export const personalReviewEnergyKeyboard = (id: string) => {
  const keyboard = new InlineKeyboard();
  for (let energy = 1; energy <= 5; energy++)
    keyboard.text(String(energy), `pui:energy:${id}:${energy}`);
  return keyboard
    .row()
    .text('⬅️ Назад', `pui:cancel:${id}`)
    .text('🏠 Меню', 'menu:home');
};

export const personalReviewEntryMessage = (
  stage: 'win' | 'blocker' | 'next',
) => {
  const prompts = {
    win: 'Что сегодня получилось? Даже один небольшой шаг.',
    blocker: 'Что мешало или отвлекало?',
    next: 'Какой маленький первый шаг сделаешь завтра?',
  };
  return `${prompts[stage]}\n\nНапиши одним сообщением, до 400 символов.`;
};

export const personalReviewConfirmMessage = (
  date: string,
  review: NonNullable<DayPlan['review']>,
) =>
  `Сохранить обзор за ${date}?\n\nЭнергия: ${review.energy}/5\nПолучилось: ${review.win}\nМешало: ${review.blocker}\nЗавтра: ${review.next}`;

export const personalReviewConfirmKeyboard = (id: string) =>
  new InlineKeyboard()
    .text('💾 Сохранить', `pui:confirm:${id}`)
    .row()
    .text('⬅️ Назад', `pui:cancel:${id}`)
    .text('🏠 Меню', 'menu:home');

export const personalDayModeKeyboard = () =>
  new InlineKeyboard()
    .text('🌤 Обычный', 'pui:normal')
    .text('⏳ Проспал', 'pui:late')
    .row()
    .text('🪫 Нет сил', 'pui:low')
    .row()
    .text('⬅️ Назад', 'pui:plan')
    .text('🏠 Меню', 'menu:home');

export const personalCapturePrompt = (area: string) =>
  `Что добавить${area === 'study' ? ' по учёбе' : area === 'gym' ? ' для зала' : ' во входящие'}?\n\nНапиши короткое название, до 500 символов. Дату и время можно задать в карточке.`;

export const personalRoutineMessage = (items: readonly string[]) =>
  `Твой распорядок\n\n08:00 — подъём и план\n08:05, 08:10 — повторы до кнопки «Я встал»\n21:30 — вечерний обзор\n00:45 — подготовка ко сну\n01:00–08:00 — тихие часы\n\nУтро:\n${items.map((item) => `▫️ ${item}`).join('\n')}\n\nНапоминания будут включены. Пары, задачи, тренировки и цели сохраняются.`;

export const personalRoutineConfirmKeyboard = (id: string) =>
  new InlineKeyboard()
    .text('✅ Применить распорядок', `pui:confirm:${id}`)
    .row()
    .text('⬅️ Назад', `pui:cancel:${id}`)
    .text('🏠 Меню', 'menu:home');
