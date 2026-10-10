import { randomUUID } from 'node:crypto';
import { addDays, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { type Composer, InlineKeyboard, InputFile } from 'grammy';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { panelNotice, panelReply } from '../services/chatPanel.js';
import {
  buildDayPlan,
  clockMinutes,
  dayPlanText,
  daySummaryText,
  minuteClock,
  type PlannerPreferences,
  parseWindow,
  plannerPreferences,
} from '../services/dayPlanner.js';
import { queryTasks } from '../services/queryTasks.js';
import {
  exportRoutineTable,
  MAX_ROUTINE_TABLE_BYTES,
  parseRoutineTable,
  readRoutineTable,
} from '../services/routineTable.js';
import {
  parseRoutineBlocks,
  type RoutineTemplate,
  routineText,
  starterTemplates,
  WEEKDAYS,
} from '../services/routineTemplates.js';
import { saveTasks } from '../services/saveTasks.js';
import { taskFingerprint } from '../services/taskNumbers.js';
import { logAndReplyError, markTaskCompleted } from '../utils/index.js';
import { splitMessages } from '../views/eisenhowerView.js';
import { MENU } from '../views/menuView.js';
import { cancelBrainDrafts, processBrainInput } from './brain.js';
import { cancelRemovalDrafts } from './removeSelected.js';

interface DayState {
  id: string;
  expires: number;
  busy?: boolean;
  step?: string;
  kind?: 'task' | 'busy';
  name?: string;
  date?: string;
  days?: number[];
  window?: { start: string; end: string };
  task?: Task;
  original?: string;
  template?: RoutineTemplate;
  assignments?: Record<string, string>;
}
const states = new Map<string, DayState>();
const key = (ctx: BotContext) => `${ctx.from!.id}:${ctx.chat!.id}`;
const fresh = (ctx: BotContext): DayState => {
  for (const [id, state] of states)
    if (state.expires < Date.now()) states.delete(id);
  const state = {
    id: randomUUID().slice(0, 8),
    expires: Date.now() + 30 * 60_000,
  };
  states.set(key(ctx), state);
  cancelBrainDrafts(ctx);
  cancelRemovalDrafts(ctx);
  ctx.session.assistant = undefined;
  ctx.session.editScene = undefined;
  ctx.session.awaitingAdd = undefined;
  return state;
};
const keyboard = (state: DayState, buttons: [string, string][]) => {
  const result = new InlineKeyboard();
  for (const [label, action] of buttons)
    result.text(label, `day:${action}:${state.id}`).row();
  return result
    .text('⬅️ Назад', `day:back:${state.id}`)
    .text('🏠 Меню', 'menu:home');
};
const screen = async (
  ctx: BotContext,
  text: string,
  state: DayState,
  buttons: [string, string][],
) => {
  const messages = splitMessages(text.split('\n'));
  for (const message of messages.slice(0, -1)) await panelReply(ctx, message);
  return panelReply(ctx, messages[messages.length - 1], {
    reply_markup: keyboard(state, buttons),
  });
};
export const openDay = async (ctx: BotContext) => {
  if (process.env.STORAGE_PROVIDER === 'notion')
    return panelReply(
      ctx,
      'Планировщик пока требует хранилище GitHub для сохранения расписания.',
    );
  const state = fresh(ctx);
  const { metadata } = await queryTasks();
  if (!metadata.timezone)
    return panelReply(ctx, 'Сначала выбери часовой пояс в настройках.');
  return screen(
    ctx,
    '🗓 День\n\nПлан учитывает занятые часы и дела со временем. Свободные дела предлагаю разместить по приоритету — ты решаешь, что выполнять.',
    state,
    [
      ['📋 План на сегодня', 'plan'],
      ['🎯 Следующий шаг', 'next'],
      ['➕ Дело со временем', 'new'],
      ['🕒 Расписание', 'schedule'],
      ['📊 Итог дня', 'summary'],
      ['⚙️ Планировка и источники', 'settings'],
      ['🔁 Шаблоны режима', 'templates'],
    ],
  );
};
const showPlan = async (ctx: BotContext, summary = false) => {
  const { taskData, metadata } = await queryTasks();
  const state = fresh(ctx);
  const plan = buildDayPlan(taskData, metadata);
  return screen(
    ctx,
    summary ? daySummaryText(plan) : dayPlanText(plan),
    state,
    [
      ['🎯 Следующий шаг', 'next'],
      ['➕ Дело со временем', 'new'],
      ['🔄 Обновить', 'plan'],
    ],
  );
};
const showSchedule = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const preferences = plannerPreferences(metadata);
  const state = fresh(ctx);
  state.original = metadata.planner_preferences;
  const days = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  return screen(
    ctx,
    [
      '🕒 Еженедельное расписание',
      '',
      ...preferences.busy.map(
        (slot) =>
          `▪️ ${slot.name} · ${slot.days.map((day) => days[day]).join(', ')} · ${slot.start}–${slot.end}`,
      ),
      ...(!preferences.busy.length ? ['Занятые часы пока не заданы.'] : []),
      '',
      'Занятия и встречи исключаются из свободного времени. Это блоки расписания, а не завершённые дела.',
    ].join('\n'),
    state,
    [
      ['➕ Занятые часы', 'busy'],
      ...preferences.busy.map(
        (slot) =>
          [`🗑 ${slot.name.slice(0, 30)}`, `drop~${slot.id}`] as [
            string,
            string,
          ],
      ),
    ],
  );
};
const showSettings = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const preferences = plannerPreferences(metadata);
  const state = fresh(ctx);
  state.original = metadata.planner_preferences;
  return screen(
    ctx,
    `⚙️ Планировка\n\nПланируемое время: ${preferences.start}–${preferences.end}.\nУтренний план / вечерний итог: ${metadata.planner_notify_times || 'выключены'}.\n\nИсточники: расписание и дела бота. Текст письма можно вставить для разбора. Автоматическое чтение Google Calendar и почты ещё не подключено.`,
    state,
    [
      ['🔁 Шаблоны режима', 'templates'],
      ['🕒 Часы планирования', 'hours'],
      ['🔔 Утро и вечер', 'notify'],
      ['📨 Дело из письма', 'mail'],
    ],
  );
};
const savePreferences = async (
  _ctx: BotContext,
  state: DayState,
  update: (value: PlannerPreferences) => PlannerPreferences,
) => {
  const latest = await queryTasks();
  if (latest.metadata.planner_preferences !== state.original)
    throw new Error('Расписание изменилось. Открой его заново.');
  latest.metadata.planner_preferences = JSON.stringify(
    update(plannerPreferences(latest.metadata)),
  );
  if (!(await saveTasks(latest.taskData, latest.metadata)))
    throw new Error('Не удалось сохранить расписание.');
};
const availableTemplates = (preferences: PlannerPreferences) => [
  ...(preferences.templates || []),
  ...starterTemplates().filter(
    (starter) =>
      !preferences.templates?.some((saved) => saved.id === starter.id),
  ),
];
const showTemplates = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const preferences = plannerPreferences(metadata);
  const state = fresh(ctx);
  state.original = metadata.planner_preferences;
  return screen(
    ctx,
    '🔁 Шаблоны режима\n\nВыбери шаблон, измени блоки и назначь дни недели. Пока он не назначен, план дня не меняется.\n\n' +
      WEEKDAYS.map((day, index) => {
        const template = preferences.templates?.find(
          (item) => item.id === preferences.weekTemplates?.[String(index + 1)],
        );
        return `${day}: ${template?.name || 'без шаблона'}`;
      }).join('\n'),
    state,
    [
      ...availableTemplates(preferences).map(
        (template) =>
          [template.name, `template~${template.id}`] as [string, string],
      ),
      ['➕ Свой шаблон', 'templateNew'],
    ],
  );
};
const showTemplate = async (ctx: BotContext, state: DayState) => {
  state.step = undefined;
  return screen(
    ctx,
    `🔁 ${state.template!.name}\n\n${routineText(state.template!)}\n\nБлоки занимают время в плане. Промежутки остаются для дел. Сон может переходить через полночь.`,
    state,
    [
      ['✏️ Название', 'templateName'],
      ['🕒 Изменить блоки', 'templateBlocks'],
      ['📅 Дни недели', 'templateDays'],
      ['✅ Сохранить шаблон', 'templateSave'],
      ['🗑 Удалить шаблон', 'templateDelete'],
      ['📑 Редактор в таблице', 'templateTable'],
    ],
  );
};
const showTableEditor = async (ctx: BotContext, state: DayState) => {
  state.step = undefined;
  return screen(
    ctx,
    `📑 ${state.template!.name} · редактор таблицы\n\nДля Excel выбери CSV с точкой с запятой (;). Если колонки не разделились, импортируй файл и укажи разделитель вручную. Для Notion и Google Sheets есть CSV с запятыми (,).\n\nКолонки: Начало | Конец | Занятие. Время — текст HH:MM. Можно добавлять, удалять и переставлять строки.\n\nЗатем выбери «Загрузить таблицу» и отправь CSV UTF-8 либо вставь скопированные строки таблицы. Импорт заменит блоки черновика; назначение дней останется. Проверишь результат и сохранишь отдельно.`,
    state,
    [
      ['📥 Скачать CSV (Excel ;)', 'templateExport'],
      ['📥 CSV (Notion ,)', 'templateExportComma'],
      ['📤 Загрузить таблицу', 'templateImport'],
    ],
  );
};
const showTemplateDays = async (ctx: BotContext, state: DayState) => {
  state.step = undefined;
  return screen(
    ctx,
    `📅 ${state.template!.name}\nВыбери дни. Сохранение заменит предыдущий режим только в выбранные дни.`,
    state,
    [
      ...WEEKDAYS.map(
        (day, index) =>
          [
            `${state.assignments?.[String(index + 1)] === state.template!.id ? '✅ ' : ''}${day}`,
            `templateDay~${index + 1}`,
          ] as [string, string],
      ),
      ['✅ Сохранить назначение', 'templateSave'],
    ],
  );
};
const dateScreen = async (ctx: BotContext, state: DayState) => {
  state.step = 'date';
  return screen(
    ctx,
    `➕ ${state.name}\n\nНа какой день? Для другой даты введи YYYY-MM-DD.`,
    state,
    [
      ['Сегодня', 'today'],
      ['Завтра', 'tomorrow'],
    ],
  );
};
const confirm = async (ctx: BotContext, state: DayState) => {
  state.step = undefined;
  return screen(
    ctx,
    `Проверка перед сохранением\n\n${state.name}\n${state.kind === 'busy' ? 'Еженедельно' : state.date} · ${state.window!.start}–${state.window!.end}\n\n${state.kind === 'busy' ? 'Занятые часы будут исключены из плана.' : 'Интервал работы, не дедлайн.'}`,
    state,
    [
      ['✅ Сохранить', 'save'],
      ['✏️ Изменить время', 'window'],
    ],
  );
};
export const registerDayPlanner = (composer: Composer<BotContext>) => {
  composer.command('day', openDay);
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text.trim();
    const state = states.get(key(ctx));
    if (text === MENU.plan) return openDay(ctx);
    if (
      text.startsWith('/') ||
      Object.values(MENU).some((label) => label === text)
    ) {
      states.delete(key(ctx));
      return next();
    }
    if (!state || state.expires < Date.now() || !state.step) return next();
    if (state.busy) return;
    state.busy = true;
    try {
      if (state.step === 'templateTable') {
        state.template!.blocks = parseRoutineTable(text);
        return await showTemplate(ctx, state);
      }
      if (state.step === 'templateName') {
        if (!text || text.length > 80)
          throw new Error('Название: от 1 до 80 символов.');
        state.template!.name = text;
        if (!state.template!.blocks.length) {
          state.step = 'templateBlocks';
          return await screen(
            ctx,
            'Введи блоки, каждый с новой строки:\n08:00-08:30 Завтрак\n23:00-07:00 Сон',
            state,
            [],
          );
        }
        return await showTemplate(ctx, state);
      }
      if (state.step === 'templateBlocks') {
        state.template!.blocks = parseRoutineBlocks(text);
        return await showTemplate(ctx, state);
      }
      if (state.step === 'mail') {
        states.delete(key(ctx));
        return await processBrainInput(ctx, text);
      }
      if (state.step === 'name') {
        if (!text || text.length > 120)
          throw new Error('Название: от 1 до 120 символов.');
        state.name = text;
        if (state.kind === 'task') return await dateScreen(ctx, state);
        state.step = undefined;
        return await screen(ctx, 'Выбери дни повторения:', state, [
          ['Каждый день', 'days~all'],
          ['Пн–Пт', 'days~week'],
          ...['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(
            (name, index) => [name, `days~${index + 1}`] as [string, string],
          ),
        ]);
      }
      if (state.step === 'date') {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
          Number.isNaN(Date.parse(text)) ||
          new Date(`${text}T12:00:00Z`).toISOString().slice(0, 10) !== text
        )
          throw new Error('Укажи существующую дату: YYYY-MM-DD.');
        state.date = text;
        state.step = 'window';
        return await screen(
          ctx,
          'Введи время начала и окончания: 18:00-19:30.',
          state,
          [],
        );
      }
      if (state.step === 'hours') {
        const window = parseWindow(text);
        await savePreferences(ctx, state, (preferences) => ({
          ...preferences,
          ...window,
        }));
        return await showSettings(ctx);
      }
      if (state.step === 'notify') {
        const times = text.split(/[\s,]+/);
        if (
          times.length !== 2 ||
          clockMinutes(times[0]) >= clockMinutes(times[1])
        )
          throw new Error('Укажи утро и вечер: 08:00 21:00.');
        const latest = await queryTasks();
        latest.metadata.planner_notify_times = times.join(',');
        if (!(await saveTasks(latest.taskData, latest.metadata)))
          throw new Error('Не удалось сохранить уведомления.');
        return await showSettings(ctx);
      }
      if (state.step === 'window') {
        state.window = parseWindow(text);
        return await confirm(ctx, state);
      }
    } catch (error) {
      await panelReply(
        ctx,
        error instanceof Error ? error.message : 'Не удалось обработать ввод.',
        { reply_markup: keyboard(state, []) },
      );
    } finally {
      state.busy = false;
    }
  });
  composer.on('message:document', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const state = states.get(key(ctx));
    if (
      !state ||
      state.expires < Date.now() ||
      state.step !== 'templateTable' ||
      !state.template
    )
      return next();
    if (state.busy) return;
    const document = ctx.message.document;
    if (
      !/\.(csv|tsv)$/i.test(document.file_name || '') ||
      (document.file_size || 0) > MAX_ROUTINE_TABLE_BYTES
    )
      return panelReply(
        ctx,
        'Нужен CSV UTF-8 или TSV до 64 КБ. XLSX и ZIP экспортируй в CSV.',
        { reply_markup: keyboard(state, []) },
      );
    state.busy = true;
    try {
      const file = await ctx.api.getFile(document.file_id);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!file.file_path || !token) throw new Error('download');
      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
        { signal: AbortSignal.timeout(15_000), redirect: 'error' },
      );
      const text = await readRoutineTable(response);
      if (
        states.get(key(ctx)) !== state ||
        state.expires < Date.now() ||
        state.step !== 'templateTable'
      )
        return;
      state.template.blocks = parseRoutineTable(text);
      return await showTemplate(ctx, state);
    } catch {
      if (
        states.get(key(ctx)) !== state ||
        state.expires < Date.now() ||
        state.step !== 'templateTable'
      )
        return;
      // Never expose download errors: Telegram file URLs contain the bot token.
      return await panelReply(
        ctx,
        'Не удалось импортировать таблицу. Проверь CSV UTF-8, колонки Начало / Конец / Занятие, время HH:MM и пересечения. Можно вставить строки текстом — тогда покажу точную ошибку.',
        { reply_markup: keyboard(state, []) },
      );
    } finally {
      state.busy = false;
    }
  });
  composer.on('callback_query:data', async (ctx, next) => {
    if (!ctx.callbackQuery.data.startsWith('day:')) {
      states.delete(key(ctx));
      return next();
    }
    if (ctx.chat?.type !== 'private') return;
    const [, action, id] = ctx.callbackQuery.data.split(':');
    const state = states.get(key(ctx));
    if (id && (!state || state.id !== id || state.expires < Date.now())) {
      await ctx.answerCallbackQuery({
        text: 'Экран устарел. Открой «План дня».',
      });
      return;
    }
    if (state?.busy) {
      await ctx.answerCallbackQuery({ text: 'Сохраняю…' });
      return;
    }
    if (state) state.busy = true;
    try {
      await ctx.answerCallbackQuery();
      if (action === 'home') return await openDay(ctx);
      if (action === 'plan') return await showPlan(ctx);
      if (action === 'summary') return await showPlan(ctx, true);
      if (action === 'schedule') return await showSchedule(ctx);
      if (action === 'settings') return await showSettings(ctx);
      if (!state) return;
      if (action === 'templates') return await showTemplates(ctx);
      if (action === 'templateNew' || action.startsWith('template~')) {
        const { metadata } = await queryTasks();
        const preferences = plannerPreferences(metadata);
        const draft = fresh(ctx);
        draft.original = metadata.planner_preferences;
        draft.assignments = { ...preferences.weekTemplates };
        if (action === 'templateNew') {
          draft.template = { id: randomUUID(), name: '', blocks: [] };
          draft.step = 'templateName';
          return await screen(ctx, 'Как назовём новый режим?', draft, []);
        }
        const template = availableTemplates(preferences).find(
          (item) => item.id === action.slice(9),
        );
        if (!template)
          throw new Error('Шаблон не найден. Открой список заново.');
        draft.template = structuredClone(template);
        return await showTemplate(ctx, draft);
      }
      if (action.startsWith('template') && state.template) {
        if (action === 'templateTable')
          return await showTableEditor(ctx, state);
        if (action === 'templateExport' || action === 'templateExportComma') {
          await ctx.replyWithDocument(
            new InputFile(
              Buffer.from(
                exportRoutineTable(
                  state.template.blocks,
                  action === 'templateExport' ? ';' : ',',
                ),
              ),
              `routine-${state.template.id}-${action === 'templateExport' ? 'excel' : 'comma'}.csv`,
            ),
            {
              caption: `${state.template.name} · разделитель: ${action === 'templateExport' ? 'точка с запятой (;)' : 'запятая (,)'}. Редактируй колонки Начало, Конец, Занятие. Затем загрузи таблицу в этой карточке.`,
            },
          );
          return await showTableEditor(ctx, state);
        }
        if (action === 'templateImport') {
          state.step = 'templateTable';
          return await screen(
            ctx,
            'Отправь CSV UTF-8 до 64 КБ или вставь скопированные строки таблицы (Начало, Конец, Занятие). XLSX и ZIP сначала экспортируй в CSV.\n\nСохранение — после проверки, отдельной кнопкой.',
            state,
            [],
          );
        }
        if (action === 'templateName' || action === 'templateBlocks') {
          state.step = action;
          return await screen(
            ctx,
            action === 'templateName'
              ? 'Введи новое название.'
              : `Отправь весь список блоков с исправлениями. Старые блоки заменятся после сохранения.\n\n${routineText(state.template)}`,
            state,
            [],
          );
        }
        if (action === 'templateDays')
          return await showTemplateDays(ctx, state);
        if (action.startsWith('templateDay~')) {
          const day = action.slice(12);
          if (!/^[1-7]$/.test(day) || !state.assignments) return;
          if (state.assignments[day] === state.template.id)
            delete state.assignments[day];
          else state.assignments[day] = state.template.id;
          return await showTemplateDays(ctx, state);
        }
        if (action === 'templateDelete')
          return await screen(
            ctx,
            'Удалить шаблон и его назначения? Дела останутся.',
            state,
            [['🗑 Подтвердить удаление', 'templateRemove']],
          );
        if (action === 'templateSave' || action === 'templateRemove') {
          const template = state.template;
          if (action === 'templateSave')
            parseRoutineBlocks(routineText(template));
          await savePreferences(ctx, state, (preferences) => {
            const templates = (preferences.templates || []).filter(
              (item) => item.id !== template.id,
            );
            if (action === 'templateSave') templates.push(template);
            if (templates.length > 12)
              throw new Error('Можно сохранить до 12 шаблонов.');
            const weekTemplates = {
              ...(state.assignments || preferences.weekTemplates),
            };
            if (action === 'templateRemove')
              for (const [day, id] of Object.entries(weekTemplates))
                if (id === template.id) delete weekTemplates[day];
            return { ...preferences, templates, weekTemplates };
          });
          return await showTemplates(ctx);
        }
      }
      if (action === 'back') {
        if (state.template) {
          if (state.step) return await showTemplate(ctx, state);
          return await showTemplates(ctx);
        }
        if (state.step === 'date') {
          state.step = 'name';
          return await screen(ctx, 'Как называется дело?', state, []);
        }
        if (state.step === 'window' && state.kind === 'task')
          return await dateScreen(ctx, state);
        if (state.step === 'window' && state.kind === 'busy') {
          state.step = 'name';
          return await screen(
            ctx,
            'Как называется блок расписания? Затем выберем дни повторения.',
            state,
            [],
          );
        }
        return await openDay(ctx);
      }
      if (action === 'mail') {
        state.step = 'mail';
        return await screen(
          ctx,
          '📨 Вставь текст письма. Покажу черновик дел перед сохранением. Доступ к почтовому ящику для этого не нужен.',
          state,
          [],
        );
      }
      if (action === 'hours') {
        state.step = 'hours';
        return await screen(
          ctx,
          'Укажи часы для планирования: 09:00-22:00.',
          state,
          [],
        );
      }
      if (action === 'notify') {
        state.step = 'notify';
        return await screen(
          ctx,
          'Укажи время утреннего плана и вечернего итога: 08:00 21:00. Сообщения приходят, пока сервер бота работает.',
          state,
          [['🔕 Выключить', 'off']],
        );
      }
      if (action === 'off') {
        const latest = await queryTasks();
        latest.metadata.planner_notify_times = 'off';
        if (!(await saveTasks(latest.taskData, latest.metadata)))
          throw new Error('Сохранение не подтверждено.');
        return await showSettings(ctx);
      }
      if (action === 'new' || action === 'busy') {
        const draft = fresh(ctx);
        draft.kind = action === 'new' ? 'task' : 'busy';
        draft.step = 'name';
        draft.original = (await queryTasks()).metadata.planner_preferences;
        return await screen(
          ctx,
          action === 'new'
            ? 'Как называется дело?'
            : 'Что занимает время? Например «Лекции» или «Тренировка».',
          draft,
          [],
        );
      }
      if (action === 'today' || action === 'tomorrow') {
        const { metadata } = await queryTasks();
        const date = formatInTimeZone(
          new Date(),
          metadata.timezone || 'UTC',
          'yyyy-MM-dd',
        );
        state.date =
          action === 'today'
            ? date
            : format(addDays(new Date(`${date}T12:00:00`), 1), 'yyyy-MM-dd');
        state.step = 'window';
        return await screen(
          ctx,
          'Введи время начала и окончания: 18:00-19:30.',
          state,
          [],
        );
      }
      if (action.startsWith('days~')) {
        const days = action.split('~')[1];
        if (state.kind !== 'busy' || !/^(all|week|[1-7])$/.test(days)) return;
        state.days =
          days === 'all'
            ? [1, 2, 3, 4, 5, 6, 7]
            : days === 'week'
              ? [1, 2, 3, 4, 5]
              : [Number(days)];
        state.step = 'window';
        return await screen(
          ctx,
          'Введи занятый интервал: 09:00-12:30.',
          state,
          [],
        );
      }
      if (action === 'window') {
        state.step = 'window';
        return await screen(
          ctx,
          'Введи новый интервал: 18:00-19:30.',
          state,
          [],
        );
      }
      if (action.startsWith('drop~')) {
        await savePreferences(ctx, state, (p) => ({
          ...p,
          busy: p.busy.filter((slot) => slot.id !== action.split('~')[1]),
        }));
        return await showSchedule(ctx);
      }
      if (action === 'save') {
        if (!state.name || !state.window || !state.kind)
          throw new Error('Черновик неполный. Начни заново.');
        if (state.kind === 'busy') {
          if (!state.days?.length) throw new Error('Выбери дни.');
          await savePreferences(ctx, state, (p) => {
            if (p.busy.length >= 30)
              throw new Error('Максимум 30 блоков расписания.');
            return {
              ...p,
              busy: [
                ...p.busy,
                {
                  id: randomUUID().slice(0, 8),
                  name: state.name!,
                  days: state.days!,
                  ...state.window!,
                },
              ],
            };
          });
          return await showSchedule(ctx);
        }
        const latest = await queryTasks();
        if (
          !state.date ||
          latest.taskData.uncompleted.some((task) => task.name === state.name)
        )
          throw new Error('Укажи дату и уникальное название дела.');
        const minutes =
          clockMinutes(state.window.end) - clockMinutes(state.window.start);
        const task: Task = {
          name: state.name,
          completed: false,
          tags: [],
          date: state.date,
          time: state.window.start,
          duration: minuteClock(minutes),
        };
        latest.taskData.uncompleted.push(task);
        if (!(await saveTasks(latest.taskData, latest.metadata)))
          throw new Error('Сохранение не подтверждено.');
        await showPlan(ctx);
        return await panelNotice(
          ctx,
          `✅ Добавлено: ${task.name} · ${task.date} ${task.time}`,
        );
      }
      if (action === 'next') {
        const latest = await queryTasks();
        const plan = buildDayPlan(latest.taskData, latest.metadata);
        const item = plan.items.find((item) => item.end > plan.clock);
        if (!item)
          return await screen(
            ctx,
            plan.overflow.length
              ? 'На сегодня свободного времени не осталось. Посмотри план и выбери, что перенести.'
              : 'На сегодня следующих шагов нет.',
            fresh(ctx),
            [['📋 План', 'plan']],
          );
        const card = fresh(ctx);
        card.task = structuredClone(item.task);
        return await screen(
          ctx,
          `🎯 Следующий шаг\n\n${item.task.name}\n${minuteClock(item.start)}–${minuteClock(item.end)}${item.start > plan.clock ? '\nНачало позже — сейчас можно сделать паузу.' : ''}`,
          card,
          [
            ['✅ Готово', 'done'],
            ['⏭ На завтра', 'defer'],
            ['📋 План', 'plan'],
          ],
        );
      }
      if ((action === 'done' || action === 'defer') && state.task) {
        const latest = await queryTasks();
        const index = latest.taskData.uncompleted.findIndex(
          (task) => taskFingerprint(task) === taskFingerprint(state.task!),
        );
        if (index < 0) throw new Error('Дело изменилось. Обнови план.');
        const task = latest.taskData.uncompleted[index];
        if (action === 'done') {
          latest.taskData.uncompleted.splice(index, 1);
          markTaskCompleted(task, latest.metadata.timezone);
          latest.taskData.completed.unshift(task);
        } else {
          const date = formatInTimeZone(
            new Date(),
            latest.metadata.timezone || 'UTC',
            'yyyy-MM-dd',
          );
          task.date = format(
            addDays(new Date(`${date}T12:00:00`), 1),
            'yyyy-MM-dd',
          );
        }
        if (!(await saveTasks(latest.taskData, latest.metadata)))
          throw new Error('Сохранение не подтверждено.');
        await showPlan(ctx);
        return await panelNotice(
          ctx,
          `${action === 'done' ? '✅ Готово' : '⏭ Перенесено на завтра'}: ${task.name}`,
        );
      }
    } catch (error) {
      await logAndReplyError(
        ctx,
        'DAY_PLANNER',
        error,
        'Не удалось выполнить действие. Проверь ввод и открой «План дня» заново.',
      );
    } finally {
      if (state) state.busy = false;
    }
  });
};
