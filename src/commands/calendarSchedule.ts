import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { type Composer, InlineKeyboard } from 'grammy';
import { googleCalendarService } from '../clients/google-calendar.js';
import type { BotContext } from '../middlewares/session.js';
import { panelReply } from '../services/chatPanel.js';
import {
  type ImportedCalendar,
  MAX_ICS_BYTES,
  parseIcsCalendar,
  readIcsResponse,
  readScheduleEvents,
} from '../services/icsCalendar.js';
import { queryTasks } from '../services/queryTasks.js';
import { saveTasks } from '../services/saveTasks.js';
import { canUseOwnerCalendar } from '../services/userScope.js';
import { splitMessages } from '../views/eisenhowerView.js';
import { MENU } from '../views/menuView.js';

interface CalendarState {
  id: string;
  expires: number;
  busy?: boolean;
  step?: 'upload';
  preview?: ImportedCalendar;
  source?: string;
  hasSchedule?: boolean;
  weekStart?: string;
}
const states = new Map<string, CalendarState>();
const syncing = new Set<number>();
const chatKey = (ctx: BotContext) => `${ctx.from!.id}:${ctx.chat!.id}`;
const createState = (ctx: BotContext): CalendarState => {
  for (const [key, value] of states)
    if (value.expires < Date.now()) states.delete(key);
  const state = {
    id: randomUUID().slice(0, 8),
    expires: Date.now() + 30 * 60_000,
  };
  states.set(chatKey(ctx), state);
  ctx.session.awaitingAdd = undefined;
  ctx.session.editScene = undefined;
  return state;
};
const keyboard = (state: CalendarState, includeSave = false) => {
  const result = new InlineKeyboard();
  if (includeSave)
    result
      .text('✅ Импортировать расписание', `calendar:save:${state.id}`)
      .row();
  else if (state.step !== 'upload') {
    result.text('📅 Сегодня в календаре', `calendar:today:${state.id}`).row();
    result.text('🗓 Неделя в календаре', `calendar:week:now:${state.id}`).row();
    if (state.weekStart)
      result
        .text('◀️ Неделя', `calendar:week:prev:${state.id}`)
        .text('Следующая ▶️', `calendar:week:next:${state.id}`)
        .row();
    result.text('📤 Импортировать .ics', `calendar:import:${state.id}`).row();
    if (state.hasSchedule)
      result.text('🔄 В Google Calendar', `calendar:sync:${state.id}`).row();
  }
  result
    .text('⬅️ Назад', `calendar:open:${state.id}`)
    .text('🏠 Меню', 'menu:home');
  return result;
};
const show = async (
  ctx: BotContext,
  text: string,
  state: CalendarState,
  includeSave = false,
) => {
  const chunks = splitMessages(text.split('\n'));
  for (const chunk of chunks.slice(0, -1)) await panelReply(ctx, chunk);
  return panelReply(ctx, chunks[chunks.length - 1] || text, {
    reply_markup: keyboard(state, includeSave),
  });
};
const showCalendar = async (ctx: BotContext) => {
  const state = createState(ctx);
  const { metadata } = await queryTasks();
  const events = readScheduleEvents(metadata.calendar_events);
  state.hasSchedule = events.length > 0;
  const last = metadata.calendar_imported_at
    ? `\nИмпортировано: ${metadata.calendar_imported_at.slice(0, 10)} · ${metadata.calendar_source_name || '.ics'}`
    : '\nРасписание пока не загружено.';
  return show(
    ctx,
    `📅 Календарь\n\nЗагрузи экспорт HM Link в формате .ics. Я покажу занятия на сегодня и буду учитывать часовой пояс расписания.${last}\nСобытий сохранено: ${events.length}.`,
    state,
  );
};
const showToday = async (ctx: BotContext) => {
  const { metadata, taskData } = await queryTasks();
  const timezone = metadata.timezone || metadata.calendar_timezone || 'UTC';
  const date = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const events = readScheduleEvents(metadata.calendar_events)
    .filter((event) => event.date === date)
    .sort((a, b) => a.start.localeCompare(b.start));
  const tasks = taskData.uncompleted.filter(
    (task) => !task.completed && task.date === date,
  );
  const lines = [`📅 План на сегодня · ${date}`, ''];
  if (events.length) {
    lines.push('ЗАНЯТИЯ');
    for (const event of events)
      lines.push(
        `${event.start}–${event.end} · ${event.title}${event.location ? `\n  📍 ${event.location}` : ''}`,
      );
  } else lines.push('На сегодня занятий в календаре нет.');
  if (tasks.length) {
    lines.push('', 'ДЕЛА');
    for (const task of tasks)
      lines.push(`${task.time ? `${task.time} · ` : '• '}${task.name}`);
  }
  const state = createState(ctx);
  state.hasSchedule = readScheduleEvents(metadata.calendar_events).length > 0;
  return show(ctx, lines.join('\n'), state);
};

const shiftDate = (date: string, days: number) => {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftDate(date, -((weekday + 6) % 7));
};
const showWeek = async (ctx: BotContext, requestedStart?: string) => {
  const { metadata, taskData } = await queryTasks();
  const timezone = metadata.timezone || metadata.calendar_timezone || 'UTC';
  const today = formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd');
  const first = requestedStart || mondayOf(today);
  const last = shiftDate(first, 6);
  const events = readScheduleEvents(metadata.calendar_events);
  const tasks = taskData.uncompleted.filter(
    (task) =>
      !task.completed && task.date && task.date >= first && task.date <= last,
  );
  const lines = [`🗓 План на неделю · ${first} — ${last}`, ''];
  for (let offset = 0; offset < 7; offset++) {
    const date = shiftDate(first, offset);
    const dayEvents = events
      .filter((event) => event.date === date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const dayTasks = tasks.filter((task) => task.date === date);
    const label = new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
    lines.push(`📍 ${label}`);
    if (!dayEvents.length && !dayTasks.length) {
      lines.push('  —');
      continue;
    }
    for (const event of dayEvents)
      lines.push(`  ${event.start}–${event.end} · ${event.title}`);
    for (const task of dayTasks)
      lines.push(`  ☑️ ${task.time ? `${task.time} · ` : ''}${task.name}`);
  }
  const state = createState(ctx);
  state.weekStart = first;
  state.hasSchedule = events.length > 0;
  return show(ctx, lines.join('\n'), state);
};

const syncSavedCalendar = async (
  ctx: BotContext,
  calendar: ImportedCalendar,
  prefix: string,
) => {
  let suffix: string;
  if (!canUseOwnerCalendar()) {
    suffix = 'Google Calendar доступен только владельцу бота.';
  } else if (!googleCalendarService.isConfigured()) {
    suffix =
      'Google Calendar пока не подключён. Расписание сохранено в боте; после настройки нажми «🔄 В Google Calendar».';
  } else if (syncing.has(ctx.from!.id)) {
    suffix = 'Синхронизация уже идёт. Подожди её завершения.';
  } else {
    syncing.add(ctx.from!.id);
    try {
      await panelReply(
        ctx,
        `📅 Сохранил расписание. Переношу ${calendar.events.length} занятий в Google Calendar…`,
      );
      const result = await googleCalendarService.syncSchedule(
        calendar.events,
        calendar.timezone,
      );
      suffix = `Google Calendar обновлён: добавлено ${result.created}, обновлено ${result.updated}, убрано старых ${result.removed}.`;
    } catch {
      suffix =
        'Не удалось закончить синхронизацию с Google Calendar. Расписание в боте сохранено; повтори кнопкой «🔄 В Google Calendar». Дубли при повторе не появятся.';
    } finally {
      syncing.delete(ctx.from!.id);
    }
  }
  const state = createState(ctx);
  state.hasSchedule = true;
  return show(ctx, `${prefix}\n\n${suffix}`, state);
};

const saveCalendar = async (
  ctx: BotContext,
  calendar: ImportedCalendar,
  source: string,
) => {
  if (syncing.has(ctx.from!.id))
    return panelReply(ctx, 'Дождись завершения текущей синхронизации.');
  const current = await queryTasks();
  current.metadata.calendar_events = JSON.stringify(calendar.events);
  current.metadata.calendar_timezone = calendar.timezone;
  current.metadata.calendar_source_name = source
    .replace(/[\r\n"\\]/g, '')
    .slice(0, 100);
  current.metadata.calendar_imported_at = new Date().toISOString();
  if (!(await saveTasks(current.taskData, current.metadata)))
    throw new Error('Не удалось сохранить календарь.');
  return syncSavedCalendar(
    ctx,
    calendar,
    `✅ Расписание импортировано: ${calendar.events.length} занятий, ${calendar.firstDate} — ${calendar.lastDate}.`,
  );
};
const preview = async (
  ctx: BotContext,
  state: CalendarState,
  calendar: ImportedCalendar,
  source: string,
) => {
  state.preview = calendar;
  state.source = source.slice(0, 100);
  state.step = undefined;
  const byCourse = new Map<string, number>();
  for (const event of calendar.events)
    byCourse.set(event.title, (byCourse.get(event.title) || 0) + 1);
  const sample = [...byCourse.entries()]
    .slice(0, 12)
    .map(([title, count]) => `• ${title} — ${count}`);
  return show(
    ctx,
    `🔎 Проверь импорт расписания\n\nСобытий: ${calendar.events.length}\nЧасовой пояс: ${calendar.timezone}\nПериод: ${calendar.firstDate} — ${calendar.lastDate}\n\n${sample.join('\n')}${byCourse.size > 12 ? `\n…и ещё ${byCourse.size - 12} курсов` : ''}\n\nПосле подтверждения новое расписание заменит сохранённое в боте и обновит занятия в Google Calendar. Остальные события не трогаю.`,
    state,
    true,
  );
};

export const registerCalendarSchedule = (composer: Composer<BotContext>) => {
  composer.command('day', showCalendar);
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text.trim();
    if (text === MENU.plan) return showToday(ctx);
    if (text === MENU.calendar) return showCalendar(ctx);
    const state = states.get(chatKey(ctx));
    if (text.startsWith('/') || Object.values(MENU).includes(text as never)) {
      states.delete(chatKey(ctx));
      return next();
    }
    if (!state || state.expires < Date.now() || state.step !== 'upload')
      return next();
    try {
      const calendar = parseIcsCalendar(text);
      return await preview(ctx, state, calendar, 'вставленный текст.ics');
    } catch (error) {
      return panelReply(
        ctx,
        error instanceof Error
          ? error.message
          : 'Не удалось прочитать календарь.',
        { reply_markup: keyboard(state) },
      );
    }
  });
  composer.on('message:document', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const document = ctx.message.document;
    const isIcs = /\.ics$/i.test(document.file_name || '');
    let state = states.get(chatKey(ctx));
    if (!isIcs && (!state || state.step !== 'upload')) return next();
    if (!state || state.expires < Date.now() || state.step !== 'upload') {
      state = createState(ctx);
      state.step = 'upload';
    }
    if (state.busy) return;
    if (!isIcs || (document.file_size || 0) > MAX_ICS_BYTES)
      return panelReply(ctx, 'Нужен файл .ics размером до 256 КБ.', {
        reply_markup: keyboard(state),
      });
    state.busy = true;
    try {
      let calendar: ImportedCalendar;
      try {
        const file = await ctx.api.getFile(document.file_id);
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!file.file_path || !token) throw new Error('download');
        const response = await fetch(
          `https://api.telegram.org/file/bot${token}/${file.file_path}`,
          { signal: AbortSignal.timeout(15_000), redirect: 'error' },
        );
        calendar = parseIcsCalendar(await readIcsResponse(response));
      } catch {
        if (states.get(chatKey(ctx)) !== state || state.expires < Date.now())
          return;
        return panelReply(
          ctx,
          'Не получилось прочитать файл. Проверь формат .ics и попробуй экспортировать расписание заново.',
          { reply_markup: keyboard(state) },
        );
      }
      if (states.get(chatKey(ctx)) !== state || state.expires < Date.now())
        return;
      return await saveCalendar(
        ctx,
        calendar,
        document.file_name || 'schedule.ics',
      );
    } catch {
      if (states.get(chatKey(ctx)) !== state || state.expires < Date.now())
        return;
      return panelReply(
        ctx,
        'Файл прочитан, но сохранить расписание не удалось. Попробуй ещё раз.',
        { reply_markup: keyboard(state) },
      );
    } finally {
      state.busy = false;
    }
  });
  composer.callbackQuery(
    /^calendar:week:(now|prev|next):([\w-]+)$/,
    async (ctx) => {
      const [, action, id] = ctx.match;
      const state = states.get(chatKey(ctx));
      if (!state || state.id !== id || state.expires < Date.now()) {
        await ctx.answerCallbackQuery({
          text: 'Экран устарел. Открой календарь заново.',
        });
        return;
      }
      if (action !== 'now' && !state.weekStart) {
        await ctx.answerCallbackQuery({
          text: 'Сначала открой план на неделю.',
        });
        return;
      }
      const start =
        action === 'now'
          ? undefined
          : shiftDate(state.weekStart!, action === 'prev' ? -7 : 7);
      await ctx.answerCallbackQuery();
      return showWeek(ctx, start);
    },
  );
  composer.callbackQuery(
    /^calendar:(open|today|import|save|sync):([\w-]+)$/,
    async (ctx) => {
      const [, action, id] = ctx.match;
      const state = states.get(chatKey(ctx));
      if (!state || state.id !== id || state.expires < Date.now()) {
        await ctx.answerCallbackQuery({
          text: 'Экран устарел. Открой календарь заново.',
        });
        return;
      }
      if (state.busy) {
        await ctx.answerCallbackQuery({ text: 'Подожди секунду…' });
        return;
      }
      state.busy = true;
      try {
        await ctx.answerCallbackQuery();
        if (action === 'open') return await showCalendar(ctx);
        if (action === 'today') return await showToday(ctx);
        if (action === 'import') {
          state.preview = undefined;
          state.step = 'upload';
          return await show(
            ctx,
            '📤 Отправь экспорт расписания из HM Link файлом .ics. После проверки файла расписание сразу сохранится в боте и отправится в Google Calendar.',
            state,
          );
        }
        if (action === 'sync') {
          const { metadata } = await queryTasks();
          const events = readScheduleEvents(metadata.calendar_events);
          if (!events.length)
            throw new Error('Сначала загрузи расписание .ics.');
          const timezone =
            metadata.calendar_timezone || metadata.timezone || 'UTC';
          return await syncSavedCalendar(
            ctx,
            {
              timezone,
              events,
              firstDate: events[0].date,
              lastDate: events[events.length - 1].date,
            },
            `📅 Сохранено занятий: ${events.length}.`,
          );
        }
        if (!state.preview) throw new Error('Подтверди импорт ещё раз.');
        return await saveCalendar(
          ctx,
          state.preview,
          state.source || 'schedule.ics',
        );
      } catch (error) {
        return panelReply(
          ctx,
          error instanceof Error
            ? error.message
            : 'Не удалось сохранить календарь.',
          { reply_markup: keyboard(state, !!state.preview) },
        );
      } finally {
        state.busy = false;
      }
    },
  );
  composer.callbackQuery(/^menu:calendar(?::(today|import))?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'today') return showToday(ctx);
    if (ctx.match[1] === 'import') {
      const state = createState(ctx);
      state.step = 'upload';
      return show(
        ctx,
        '📤 Отправь экспорт расписания из HM Link файлом .ics. После проверки бот сразу сохранит и отправит занятия в Google Calendar.',
        state,
      );
    }
    return showCalendar(ctx);
  });
};
