import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { type Composer, InlineKeyboard } from 'grammy';
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
import { splitMessages } from '../views/eisenhowerView.js';
import { MENU } from '../views/menuView.js';

interface CalendarState {
  id: string;
  expires: number;
  busy?: boolean;
  step?: 'upload';
  preview?: ImportedCalendar;
  source?: string;
}
const states = new Map<string, CalendarState>();
const chatKey = (ctx: BotContext) => `${ctx.from!.id}:${ctx.chat!.id}`;
const createState = (ctx: BotContext): CalendarState => {
  for (const [key, value] of states)
    if (value.expires < Date.now()) states.delete(key);
  const state = {
    id: randomUUID().slice(0, 8),
    expires: Date.now() + 30 * 60_000,
  };
  states.set(chatKey(ctx), state);
  ctx.session.assistant = undefined;
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
    result.text('📅 План на сегодня', `calendar:today:${state.id}`).row();
    result.text('📤 Импортировать .ics', `calendar:import:${state.id}`).row();
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
  return show(ctx, lines.join('\n'), state);
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
    `🔎 Проверь импорт расписания\n\nСобытий: ${calendar.events.length}\nЧасовой пояс: ${calendar.timezone}\nПериод: ${calendar.firstDate} — ${calendar.lastDate}\n\n${sample.join('\n')}${byCourse.size > 12 ? `\n…и ещё ${byCourse.size - 12} курсов` : ''}\n\nПосле подтверждения новое расписание заменит сохранённое.`,
    state,
    true,
  );
};

export const registerCalendarSchedule = (composer: Composer<BotContext>) => {
  composer.command('day', showCalendar);
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text.trim();
    if (text === MENU.plan) return showCalendar(ctx);
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
    const state = states.get(chatKey(ctx));
    if (!state || state.expires < Date.now() || state.step !== 'upload')
      return next();
    if (state.busy) return;
    const document = ctx.message.document;
    if (
      !/\.ics$/i.test(document.file_name || '') ||
      (document.file_size || 0) > MAX_ICS_BYTES
    )
      return panelReply(ctx, 'Нужен файл .ics размером до 256 КБ.', {
        reply_markup: keyboard(state),
      });
    state.busy = true;
    try {
      const file = await ctx.api.getFile(document.file_id);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!file.file_path || !token) throw new Error('download');
      const response = await fetch(
        `https://api.telegram.org/file/bot${token}/${file.file_path}`,
        { signal: AbortSignal.timeout(15_000), redirect: 'error' },
      );
      const decoded = await readIcsResponse(response);
      if (states.get(chatKey(ctx)) !== state || state.expires < Date.now())
        return;
      return await preview(
        ctx,
        state,
        parseIcsCalendar(decoded),
        document.file_name || 'schedule.ics',
      );
    } catch {
      if (states.get(chatKey(ctx)) !== state || state.expires < Date.now())
        return;
      return panelReply(
        ctx,
        'Не получилось прочитать файл. Проверь формат .ics и попробуй экспортировать расписание заново.',
        { reply_markup: keyboard(state) },
      );
    } finally {
      state.busy = false;
    }
  });
  composer.callbackQuery(
    /^calendar:(open|today|import|save):([\w-]+)$/,
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
            '📤 Отправь экспорт расписания из HM Link файлом .ics. Перед сохранением я проверю даты, часовой пояс и список занятий.',
            state,
          );
        }
        if (!state.preview) throw new Error('Подтверди импорт ещё раз.');
        const current = await queryTasks();
        current.metadata.calendar_events = JSON.stringify(state.preview.events);
        current.metadata.calendar_timezone = state.preview.timezone;
        current.metadata.calendar_source_name = (state.source || 'schedule.ics')
          .replace(/[\r\n"\\]/g, '')
          .slice(0, 100);
        current.metadata.calendar_imported_at = new Date().toISOString();
        if (!(await saveTasks(current.taskData, current.metadata)))
          throw new Error('Не удалось сохранить календарь.');
        return await panelReply(
          ctx,
          `✅ Расписание импортировано: ${state.preview.events.length} занятий, ${state.preview.firstDate} — ${state.preview.lastDate}.`,
          {
            reply_markup: new InlineKeyboard()
              .text(
                '📅 План на сегодня',
                `calendar:today:${createState(ctx).id}`,
              )
              .text('🏠 Меню', 'menu:home'),
          },
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
        '📤 Отправь экспорт расписания из HM Link файлом .ics.',
        state,
      );
    }
    return showCalendar(ctx);
  });
};
