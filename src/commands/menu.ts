import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { type Composer, InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { enterEditScene } from '../scenes/editTaskScene.js';
import { panelNotice, panelReply } from '../services/chatPanel.js';
import { QUADRANTS, setQuadrant } from '../services/eisenhower.js';
import { queryTasks } from '../services/queryTasks.js';
import { parseReminderTimes } from '../services/reminders.js';
import { saveTasks } from '../services/saveTasks.js';
import {
  numberedTasks,
  rememberTaskNumbers,
  taskFingerprint,
} from '../services/taskNumbers.js';
import { logAndReplyError, markTaskCompleted } from '../utils/index.js';
import {
  ADD_TEXT,
  HOME_TEXT,
  SETTINGS_TEXT,
  taskCardText,
} from '../views/botStyle.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';
import {
  MENU,
  mainKeyboard,
  navigationKeyboard,
  settingsKeyboard,
  timeKeyboard,
} from '../views/menuView.js';
import { openAssistant } from './assistant.js';
import { cancelBrainDrafts, processBrainInput } from './brain.js';
import { showNow } from './now.js';
import { cancelRemovalDrafts, previewRemoval } from './removeSelected.js';
import { applyTimezone } from './timezone.js';

interface MenuState {
  id: string;
  expires: number;
  input?: 'brain' | 'time';
  tasks?: Task[];
  today?: boolean;
  selected?: Task;
  times?: string[];
  timeIndex?: number;
  timeHour?: string;
  originalTimes?: string;
  originalSaved?: string;
  busy?: boolean;
}
const states = new Map<number, MenuState>();
const newState = (ctx: BotContext): MenuState => {
  for (const [user, state] of states)
    if (state.expires < Date.now()) states.delete(user);
  const state = {
    id: randomUUID().slice(0, 8),
    expires: Date.now() + 30 * 60_000,
  };
  states.set(ctx.from!.id, state);
  return state;
};

export const clearMenuInput = (ctx: BotContext) => {
  const state = ctx.from && states.get(ctx.from.id);
  if (state) state.input = undefined;
};

export const menuCommand = async (ctx: BotContext) => {
  ctx.session.assistant = undefined;
  cancelBrainDrafts(ctx);
  cancelRemovalDrafts(ctx);
  newState(ctx);
  ctx.session.awaitingAdd = undefined;
  ctx.session.editScene = undefined;
  await panelReply(ctx, HOME_TEXT, {
    reply_markup: mainKeyboard(),
    parse_mode: 'HTML',
  });
};

export const returnToTaskList = async (ctx: BotContext) => {
  const today = states.get(ctx.from!.id)?.today ?? false;
  return showTasks(ctx, today);
};

export const showTasks = async (ctx: BotContext, today = false, page = 0) => {
  const { taskData, metadata } = await queryTasks();
  const date = formatInTimeZone(
    new Date(),
    metadata.timezone || 'UTC',
    'yyyy-MM-dd',
  );
  const tasks = numberedTasks(
    taskData.uncompleted.filter(
      (task) => !task.completed && (!today || !task.date || task.date <= date),
    ),
  );
  const state = newState(ctx);
  state.tasks = structuredClone(tasks);
  state.today = today;
  const messages = splitMessages([
    today ? `📋 Сегодня · ${date}` : `📚 Все дела · ${tasks.length}`,
    '',
    ...matrixLines(tasks),
  ]);
  for (const message of messages.slice(0, -1)) await panelReply(ctx, message);
  rememberTaskNumbers(ctx.from!.id, ctx.chat!.id, tasks);
  if (!tasks.length)
    return await panelReply(ctx, messages[messages.length - 1]);
  const lastPage = Math.max(0, Math.ceil(tasks.length / 6) - 1);
  await showPicker(
    ctx,
    state,
    Math.min(page, lastPage),
    messages[messages.length - 1],
  );
};

const showPicker = async (
  ctx: BotContext,
  state: MenuState,
  page: number,
  list?: string,
) => {
  const tasks = state.tasks ?? [];
  const keyboard = new InlineKeyboard();
  for (
    let index = page * 6;
    index < Math.min(tasks.length, (page + 1) * 6);
    index++
  )
    keyboard
      .text(
        `${index + 1}. ${tasks[index].name.slice(0, 40)}`,
        `menu:task:${state.id}:${index}`,
      )
      .row();
  if (page > 0) keyboard.text('◀️', `menu:page:${state.id}:${page - 1}`);
  if ((page + 1) * 6 < tasks.length)
    keyboard.text('▶️', `menu:page:${state.id}:${page + 1}`);
  keyboard.row().text('⬅️ Назад', 'menu:home').text('🏠 Меню', 'menu:home');
  await panelReply(
    ctx,
    `${list ? `${list}\n\n` : ''}Выбирай дело — разберёмся с ним.`,
    { reply_markup: keyboard },
  );
};

const savedTimes = (metadata: {
  reminder_times?: string;
  reminder_saved_times?: string;
}): string[] => {
  const value =
    metadata.reminder_times && metadata.reminder_times !== 'off'
      ? metadata.reminder_times
      : metadata.reminder_saved_times;
  return value ? parseReminderTimes(value) : ['09:00', '19:00'];
};

const showReminders = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const times = savedTimes(metadata);
  const enabled =
    !!metadata.reminder_times && metadata.reminder_times !== 'off';
  const state = newState(ctx);
  state.times = times;
  state.originalTimes = metadata.reminder_times;
  state.originalSaved = metadata.reminder_saved_times;
  const keyboard = new InlineKeyboard()
    .text(enabled ? '🔕 Выключить' : '🔔 Включить', `menu:toggle:${state.id}`)
    .row();
  times.forEach((time, index) => {
    keyboard
      .text(`🕒 ${time} — изменить`, `menu:slot:${state.id}:${index}`)
      .text(`🗑 ${time}`, `menu:deltime:${state.id}:${index}`)
      .row();
  });
  if (times.length < 4)
    keyboard.text('➕ Добавить время', `menu:slot:${state.id}:new`).row();
  keyboard
    .text('🔔 Проверить', 'menu:test')
    .row()
    .text('Назад', 'menu:settings');
  await panelReply(
    ctx,
    `🔔 Напоминания ${enabled ? 'включены' : 'выключены'}\nЧасовой пояс: ${metadata.timezone || 'не задан'}\n\nВ выбранное время пришлю сообщение со списком дел.`,
    { reply_markup: keyboard },
  );
};

const writeTimes = async (
  ctx: BotContext,
  state: MenuState,
  times: string[],
  enabled?: boolean,
) => {
  const { taskData, metadata } = await queryTasks();
  if (
    metadata.reminder_times !== state.originalTimes ||
    metadata.reminder_saved_times !== state.originalSaved
  )
    throw new Error('Reminder settings changed');
  if (!metadata.timezone)
    return await panelReply(ctx, 'Сначала выбери часовой пояс в настройках.');
  const schedule = times.length ? parseReminderTimes(times.join(',')) : [];
  const active =
    enabled ?? (!!metadata.reminder_times && metadata.reminder_times !== 'off');
  metadata.reminder_saved_times = schedule.length ? schedule.join(',') : 'off';
  metadata.reminder_times =
    active && schedule.length ? schedule.join(',') : 'off';
  await saveTasks(taskData, metadata);
  await showReminders(ctx);
};

const saveSelectedTime = async (
  ctx: BotContext,
  state: MenuState,
  time: string,
) => {
  parseReminderTimes(time);
  const times = [...(state.times ?? [])];
  if (state.timeIndex === undefined) times.push(time);
  else times[state.timeIndex] = time;
  state.input = undefined;
  await writeTimes(ctx, state, times);
};

const card = async (ctx: BotContext, state: MenuState, task: Task) => {
  state.id = randomUUID().slice(0, 8);
  state.selected = task;
  const keyboard = new InlineKeyboard()
    .text('✅ Готово', `menu:done:${state.id}`)
    .text('✏️ Изменить', `menu:edit:${state.id}`)
    .row()
    .text('↔️ Важность', `menu:importance:${state.id}`)
    .text('🗑 Удалить', `menu:delete:${state.id}`)
    .row()
    .text(
      task.priorityLocked
        ? '🧠 Разрешить ИИ менять раздел'
        : '🔒 Защитить категорию',
      `menu:lock:${state.id}`,
    )
    .row()
    .text('⬅️ Назад', `menu:tasks:${state.id}`)
    .text('🏠 Меню', 'menu:home');
  await panelReply(ctx, taskCardText(task), {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
};

export const registerMenu = (composer: Composer<BotContext>) => {
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text.trim();
    try {
      if (Object.values(MENU).some((label) => label === text)) {
        ctx.session.assistant = undefined;
        ctx.session.awaitingAdd = undefined;
        ctx.session.editScene = undefined;
        if (text === MENU.home) return await menuCommand(ctx);
        if (text === MENU.back) return await backToTask(ctx);
        if (text === MENU.chat) {
          newState(ctx);
          return await openAssistant(ctx);
        }
        if (text === MENU.settings) {
          newState(ctx);
          return await panelReply(ctx, SETTINGS_TEXT, {
            parse_mode: 'HTML',
            reply_markup: settingsKeyboard(),
          });
        }
        if (text === MENU.now) {
          newState(ctx);
          return await showNow(ctx);
        }
        if (text === MENU.add) return await showAddPrompt(ctx);
        return await showTasks(ctx, text === MENU.today);
      }
      const state = states.get(ctx.from.id);
      if (text.startsWith('/')) {
        if (state) state.input = undefined;
        return next();
      }
      if (!state || state.expires < Date.now() || !state.input) return next();
      if (state.input === 'brain') {
        state.input = undefined;
        return await processBrainInput(ctx, text);
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text))
        return await panelReply(
          ctx,
          'Введи время как 09:30 или нажми «🏠 Меню» для отмены.',
        );
      await saveSelectedTime(ctx, state, text);
    } catch (error) {
      logAndReplyError(
        ctx,
        'MENU',
        error,
        'Не удалось выполнить действие. Открой меню заново.',
      );
    }
  });

  composer.on('message:voice', async (ctx, next) => {
    const state = ctx.from && states.get(ctx.from.id);
    if (state?.input) state.input = undefined;
    return next();
  });

  composer.callbackQuery(/^menu:(.+)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery({ text: 'Открой личный чат с ботом.' });
      return;
    }
    const [action, id, value] = ctx.match[1].split(':');
    ctx.session.assistant = undefined;
    const state = states.get(ctx.from.id);
    if (
      id &&
      action !== 'tz' &&
      (!state || state.id !== id || state.expires < Date.now())
    ) {
      await ctx.answerCallbackQuery({
        text: 'Меню устарело. Открой его заново.',
      });
      return;
    }
    if (state?.busy) {
      await ctx.answerCallbackQuery({ text: 'Выполняю…' });
      return;
    }
    if (state) state.busy = true;
    try {
      await ctx.answerCallbackQuery();
      ctx.session.awaitingAdd = undefined;
      ctx.session.editScene = undefined;
      if (action === 'home') return await menuCommand(ctx);
      if (action === 'back') return await backToTask(ctx);
      if (action === 'settings') {
        newState(ctx);
        return await panelReply(ctx, SETTINGS_TEXT, {
          parse_mode: 'HTML',
          reply_markup: settingsKeyboard(),
        });
      }
      if (action === 'reminders') return await showReminders(ctx);
      if (action === 'timezone') {
        newState(ctx);
        return await panelReply(ctx, '🌍 Выбери часовой пояс:', {
          reply_markup: new InlineKeyboard()
            .text('Берлин / Мюнхен', 'menu:tz:Europe/Berlin')
            .row()
            .text('Клуж / Бухарест', 'menu:tz:Europe/Bucharest')
            .row()
            .text('Кишинёв', 'menu:tz:Europe/Chisinau')
            .row()
            .text('Назад', 'menu:settings'),
        });
      }
      if (action === 'tz') {
        if (
          !['Europe/Berlin', 'Europe/Bucharest', 'Europe/Chisinau'].includes(id)
        )
          return;
        await applyTimezone(ctx, id);
        return await showReminders(ctx);
      }
      if (action === 'test') {
        const { taskData, metadata } = await queryTasks();
        const date = formatInTimeZone(
          new Date(),
          metadata.timezone || 'UTC',
          'yyyy-MM-dd',
        );
        const tasks = taskData.uncompleted.filter(
          (task) => !task.completed && (!task.date || task.date <= date),
        );
        for (const message of splitMessages([
          '🔔 Пробное напоминание',
          '',
          ...matrixLines(tasks),
        ]))
          await panelReply(ctx, message);
        rememberTaskNumbers(ctx.from.id, ctx.chat.id, tasks);
        return;
      }
      if (!state) return;
      if (action === 'toggle')
        return await writeTimes(
          ctx,
          state,
          state.times?.length ? state.times : ['09:00', '19:00'],
          !state.originalTimes || state.originalTimes === 'off',
        );
      if (action === 'deltime')
        return await writeTimes(
          ctx,
          state,
          (state.times ?? []).filter((_, index) => index !== Number(value)),
        );
      if (action === 'tasks' && state.tasks) {
        state.input = undefined;
        return await showTasks(ctx, state.today);
      }
      if (action === 'card' && state.selected)
        return await card(ctx, state, state.selected);
      if (action === 'minutes') {
        state.input = undefined;
        return await panelReply(ctx, 'Выбери минуты:', {
          reply_markup: timeKeyboard(state.id, state.timeHour),
        });
      }
      if (action === 'hours') {
        state.input = undefined;
        state.timeHour = undefined;
        return await panelReply(ctx, 'Выбери час:', {
          reply_markup: timeKeyboard(state.id),
        });
      }
      if (action === 'slot') {
        state.id = randomUUID().slice(0, 8);
        state.timeHour = undefined;
        state.timeIndex = value === 'new' ? undefined : Number(value);
        return await panelReply(ctx, 'Выбери час:', {
          reply_markup: timeKeyboard(state.id),
        });
      }
      if (action === 'hour') {
        state.timeHour = value;
        return await panelReply(ctx, 'Выбери минуты:', {
          reply_markup: timeKeyboard(state.id, value),
        });
      }
      if (action === 'custom') {
        state.input = 'time';
        return await panelReply(ctx, 'Введи время: HH:MM, например 09:20.', {
          reply_markup: navigationKeyboard(
            `menu:${state.timeHour ? 'minutes' : 'hours'}:${state.id}`,
          ),
        });
      }
      if (action === 'time')
        return await saveSelectedTime(
          ctx,
          state,
          `${value.slice(0, 2)}:${value.slice(2)}`,
        );
      if (action === 'page')
        return await showTasks(ctx, state.today, Number(value));
      if (action === 'task') {
        const task = state.tasks?.[Number(value)];
        if (task) await card(ctx, state, task);
        return;
      }
      if (action === 'importance') {
        const keyboard = new InlineKeyboard();
        QUADRANTS.forEach((title, index) => {
          keyboard.text(title, `menu:q:${state.id}:${index + 1}`).row();
        });
        keyboard
          .row()
          .text('⬅️ Назад', `menu:card:${state.id}`)
          .text('🏠 Меню', 'menu:home');
        return await panelReply(ctx, 'Выбери раздел:', {
          reply_markup: keyboard,
        });
      }
      const task = state.selected;
      if (!task) return;
      const { taskData, metadata } = await queryTasks();
      const index = taskData.uncompleted.findIndex(
        (live) => taskFingerprint(live) === taskFingerprint(task),
      );
      if (index < 0)
        return await panelReply(
          ctx,
          'Дело изменилось. Открой «📚 Все дела» заново.',
        );
      if (action === 'delete') return await previewRemoval(ctx, [task]);
      if (action === 'edit') return await enterEditScene(ctx, index, task);
      if (action === 'done') {
        const live = taskData.uncompleted.splice(index, 1)[0];
        markTaskCompleted(live, metadata.timezone);
        taskData.completed.unshift(live);
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('Storage did not confirm save');
        await returnToTaskList(ctx);
        return await panelNotice(ctx, `✅ Готово: ${task.name}`, {
          reply_markup: new InlineKeyboard().text('⬅️ Назад', 'menu:home'),
        });
      }
      if (action === 'lock') {
        const updated = {
          ...taskData.uncompleted[index],
          priorityLocked: !task.priorityLocked,
        };
        taskData.uncompleted[index] = updated;
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('Save not confirmed');
        return await returnToTaskList(ctx);
      }
      if (action === 'q' && /^[1-4]$/.test(value)) {
        const updated = setQuadrant(taskData.uncompleted[index], Number(value));
        taskData.uncompleted[index] = updated;
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('Save not confirmed');
        await returnToTaskList(ctx);
      }
    } catch (error) {
      logAndReplyError(
        ctx,
        'MENU',
        error,
        'Не удалось выполнить действие. Открой меню заново.',
      );
    } finally {
      if (state) state.busy = false;
    }
  });
};

export const showAddPrompt = async (ctx: BotContext) => {
  cancelBrainDrafts(ctx);
  cancelRemovalDrafts(ctx);
  ctx.session.awaitingAdd = undefined;
  ctx.session.editScene = undefined;
  newState(ctx).input = 'brain';
  await panelReply(ctx, ADD_TEXT, {
    parse_mode: 'HTML',
    reply_markup: navigationKeyboard('menu:home'),
  });
};

export const backToTask = async (ctx: BotContext) => {
  ctx.session.awaitingAdd = undefined;
  ctx.session.editScene = undefined;
  const state = ctx.from && states.get(ctx.from.id);
  if (!state || state.expires < Date.now()) return await menuCommand(ctx);
  state.input = undefined;
  if (state.selected) return await card(ctx, state, state.selected);
  if (state.tasks) return await showTasks(ctx, state.today);
  return await menuCommand(ctx);
};
