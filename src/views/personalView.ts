import { formatInTimeZone } from 'date-fns-tz';
import { InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import {
  AREAS,
  createDayPlan,
  type DayPlan,
  localDate,
  type PersonalState,
  type Reminder,
  weeklySummary,
} from '../services/personal.js';

export const AREA_LABELS = {
  study: 'Учёба',
  gym: 'Зал',
  project: 'Проекты',
  social: 'Общение',
  life: 'Быт',
};

export const personalNavigation = () =>
  new InlineKeyboard()
    .text('⬅️ Мой день', 'pui:home')
    .text('🏠 Меню', 'menu:home');

export const personalPlanKeyboard = (tasks: Task[]) => {
  const keyboard = new InlineKeyboard();
  for (const task of tasks)
    keyboard.text(`✓ ${task.name.slice(0, 40)}`, `pd:${task.id}`).row();
  return keyboard
    .text('🎯 Приоритеты', 'pui:focus')
    .text('👣 Первый шаг', 'pui:step')
    .row()
    .text('⚡ Режим дня', 'pui:mode')
    .text('🌅 Моё утро', 'pui:checklist')
    .row()
    .text('⬅️ Назад', 'pui:home')
    .text('🏠 Меню', 'menu:home');
};

export const personalReminderKeyboard = (reminder: Reminder, date: string) => {
  const keyboard = new InlineKeyboard();
  if (reminder.kind === 'morning' || reminder.kind === 'wake')
    keyboard
      .text('🙌 Я встал', `pui:awake:${reminder.date ?? date}`)
      .text('☀️ Моё утро', 'pui:checklist')
      .row();
  if (reminder.kind === 'evening')
    keyboard.text('🌙 Подвести итог', 'pui:evening');
  else if (reminder.kind === 'weekly')
    keyboard.text('📊 Итоги недели', 'pui:week');
  else keyboard.text('📋 Мой план', 'pui:plan');
  return keyboard;
};
export const PERSONAL_HELP = `Личная система

Открой «Мой день» в меню: план, приоритеты, утро, обзор, учёба, зал и режим доступны кнопками.

Быстрая запись без ИИ: /inbox текст задачи.
/inbox — входящие; /inbox текст #study — быстро записать
/focus — выбрать до трёх приоритетов кнопками
/morning — план дня; /step текст — первый шаг
/late — проспал; /lowenergy — нет сил; /normal — обычный режим
/evening — вечерний обзор; /week — последние 7 дней
/goals — цели на 90 дней; /personalreminders — напоминания
/coaching — состав сводки и согласие на экспорт
/cancel — выйти из диалога

Направления: #study, #gym, #project, #social, #life.
Дела с датой и временем добавляй через /add: появится предложение Google Calendar.
Просроченное не переносится автоматически. Один сделанный шаг тоже считается.`;

export const planMessage = (
  state: PersonalState,
  tasks: Task[],
  timezone: string,
  now = new Date(),
): string => {
  const date = localDate(now, timezone);
  const day: DayPlan = state.days[date] ?? createDayPlan();
  const priorities = day.priorities.map((id) =>
    tasks.find((task) => task.id === id),
  );
  const active = priorities.filter(
    (task): task is Task => !!task && !task.completed,
  );
  const visible = day.mode === 'normal' ? priorities : active.slice(0, 1);
  const mode = {
    normal: 'Обычный день',
    late: 'День продолжается',
    low: 'Бережный режим',
  }[day.mode];
  const currentTime = formatInTimeZone(now, timezone, 'HH:mm');
  const events = tasks
    .filter(
      (task) =>
        !task.completed &&
        task.date === date &&
        task.time &&
        task.time >= currentTime,
    )
    .sort((a, b) => a.time!.localeCompare(b.time!));
  const missed = tasks.filter(
    (task) =>
      !task.completed &&
      task.date === date &&
      task.time &&
      task.time < currentTime,
  );
  const first =
    day.firstStep ||
    (active[0]
      ? `Открой «${active[0].name}» и сделай первые 5 минут.`
      : 'Встань, выпей воды и выбери одно дело кнопкой «Приоритеты».');
  return [
    `${mode} · ${date} · ${currentTime}`,
    day.mode === 'late'
      ? 'Не нужно догонять всё утро. Выбери одно полезное действие на оставшийся день.'
      : day.mode === 'low'
        ? 'Оставь один шаг на 5 минут. После него можно остановиться.'
        : 'До трёх результатов на сегодня. Время встреч — отдельно.',
    '\nПриоритеты:',
    ...(visible.length
      ? visible.map(
          (task, index) =>
            `${index + 1}. ${task ? `${task.completed ? '✓' : '○'} ${task.name}` : 'Задача удалена — обнови /focus'}`,
        )
      : ['Пока не выбраны — нажми «Приоритеты».']),
    `\nПервый шаг: ${first}`,
    '\nПредстоящие события:',
    ...(events.length
      ? events.slice(0, 12).map((task) => `${task.time} · ${task.name}`)
      : ['На сегодня нет.']),
    ...(events.length > 12 ? ['Остальные — /today'] : []),
    ...(missed.length
      ? [
          `\nПрошедших слотов: ${missed.length}. Проверь их через /today; при необходимости измени время через /edit.`,
        ]
      : []),
    '\nВыбрать приоритеты, первый шаг и режим дня можно кнопками ниже.',
  ].join('\n');
};

export const weekMessage = (
  state: PersonalState,
  tasks: Task[],
  timezone: string,
  now = new Date(),
) => {
  const summary = weeklySummary(state, tasks, timezone, now);
  return [
    `Последние 7 дней · ${summary.start} — ${summary.end}`,
    `Завершено дел: ${summary.completed}`,
    `Утренних планов: ${summary.plannedDays} · обзоров: ${summary.reviewedDays}`,
    `Средняя энергия: ${summary.averageEnergy ?? 'нет данных'}`,
    `Режим «проспал»: ${summary.lateDays} · «нет сил»: ${summary.lowEnergyDays}`,
    ...AREAS.map((area) => `${AREA_LABELS[area]}: ${summary.areas[area]}`),
    ...(summary.unknownCompletionDates
      ? [
          `У ${summary.unknownCompletionDates} старых завершённых дел дата неизвестна; они не включены в результат недели.`,
        ]
      : []),
    '\nЧто помогло? Что убрать? Выбери одно изменение на следующую неделю и обнови /goals.',
  ].join('\n');
};

export const EVENING_HELP = `Короткий вечерний обзор — без оценки себя.
Что получилось? Что мешало? Какой первый шаг завтра?

Пришли одной командой:
/evening энергия 1–5 | что получилось | что мешало | первый шаг завтра

Например:
/evening 3 | сделал одну задачу | телефон отвлекал | открыть конспект

Каждое поле — до 400 символов. Повторный обзор обновит сегодняшний.`;

export const COACHING_INFO = `Сводка для коучинга — только по твоему запросу.

Файл содержит последние 7 дней: число завершённых дел по направлениям, планы и обзоры, среднюю энергию, режимы дня; также числовой прогресс целей и сроки.
Названия задач и целей, тексты обзоров, ссылки, Telegram ID и токены в экспорт не входят.

После согласия /coaching export выдаст JSON-файл в этот личный чат. Ты сам решаешь, загружать ли его в ChatGPT. Автоматической передачи нет.
/coaching off отключает будущий экспорт. Уже выданные файлы остаются у получателя; их нужно удалить отдельно.`;
