import { InlineKeyboard } from 'grammy';

export const iphoneAlarmPlan = (enabled: boolean) =>
  `TMALARM1\n${enabled ? 'on' : 'off'}\n08:00\n08:05\n08:10`;

export const iphoneAlarmKeyboard = () =>
  new InlineKeyboard()
    .copyText('📋 Скопировать включение', iphoneAlarmPlan(true))
    .row()
    .copyText('📋 Скопировать выключение', iphoneAlarmPlan(false))
    .row()
    .url(
      '📖 Настройка на iPhone',
      'https://github.com/iliayuou-byte/task-manager_01/blob/feat/personal-planning/docs/iphone-alarms-ru.md',
    )
    .row()
    .text('⬅️ Назад', 'pui:settings')
    .text('🏠 Меню', 'menu:home');

export const iphoneAlarmMessage = (morning: string) =>
  `⏰ Будильники iPhone · шаблон 08:00, 08:05, 08:10\n\nОдин раз создай на iPhone команду «TaskManager Alarms» по инструкции ниже. Затем скопируй включение или выключение кнопкой и вручную запусти эту команду в приложении «Команды». Проверь результат в «Часах».\n\nКнопка только копирует план: будильники ещё не изменены. Команда управляет состоянием трёх явно выбранных будильников, а время задаётся в «Часах». Текст условий команды оставляй неизменным. Бот не получает доступ к телефону и не видит результат. «Я встал» останавливает только повторы Telegram.\n\n${morning === '08:00' ? 'При смене расписания отдельно измени время будильников на телефоне.' : `В боте подъём ${morning}; перед применением проверь время трёх будильников в «Часах»: бот его не меняет и не проверяет.`}`;
