import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { type Composer, InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { enterEditScene } from '../scenes/editTaskScene.js';
import { getQuadrant, QUADRANTS, setQuadrant } from '../services/eisenhower.js';
import { queryTasks } from '../services/queryTasks.js';
import { parseReminderTimes } from '../services/reminders.js';
import { saveTasks } from '../services/saveTasks.js';
import {
  numberedTasks,
  rememberTaskNumbers,
  taskFingerprint,
} from '../services/taskNumbers.js';
import { logAndReplyError, markTaskCompleted } from '../utils/index.js';
import { matrixLines, splitMessages } from '../views/eisenhowerView.js';
import {
  MENU,
  mainKeyboard,
  settingsKeyboard,
  timeKeyboard,
} from '../views/menuView.js';
import { processBrainInput } from './brain.js';
import { showNow } from './now.js';
import { previewRemoval } from './removeSelected.js';
import { applyTimezone } from './timezone.js';

interface MenuState {
  id: string;
  expires: number;
  input?: 'brain' | 'time';
  tasks?: Task[];
  selected?: Task;
  times?: string[];
  timeIndex?: number;
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

export const menuCommand = async (ctx: BotContext) => {
  newState(ctx);
  ctx.session.awaitingAdd = undefined;
  ctx.session.editScene = undefined;
  await ctx.reply(
    'Выбирай действие кнопками. Дела можно добавлять текстом или ГС.',
    { reply_markup: mainKeyboard() },
  );
};

const showTasks = async (ctx: BotContext, today = false) => {
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
  for (const message of splitMessages([
    today ? `📋 Сегодня · ${date}` : '📚 Все незавершённые дела',
    '',
    ...matrixLines(tasks),
  ]))
    await ctx.reply(message);
  rememberTaskNumbers(ctx.from!.id, ctx.chat!.id, tasks);
  if (!tasks.length) return;
  await showPicker(ctx, state, 0);
};

const showPicker = async (ctx: BotContext, state: MenuState, page: number) => {
  const tasks = state.tasks ?? [];
  const keyboard = new InlineKeyboard();
  for (
    let index = page * 8;
    index < Math.min(tasks.length, (page + 1) * 8);
    index++
  )
    keyboard
      .text(
        `${index + 1}. ${tasks[index].name.slice(0, 40)}`,
        `menu:task:${state.id}:${index}`,
      )
      .row();
  if (page > 0) keyboard.text('◀️', `menu:page:${state.id}:${page - 1}`);
  if ((page + 1) * 8 < tasks.length)
    keyboard.text('▶️', `menu:page:${state.id}:${page + 1}`);
  keyboard.row().text('🏠 Меню', 'menu:home');
  await ctx.reply(
    'Нажми на дело, чтобы выполнить, изменить важность или удалить:',
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
      .text('✖️', `menu:deltime:${state.id}:${index}`)
      .row();
  });
  if (times.length < 4)
    keyboard.text('➕ Добавить время', `menu:slot:${state.id}:new`).row();
  keyboard
    .text('🔔 Проверить', 'menu:test')
    .row()
    .text('Назад', 'menu:settings');
  await ctx.reply(
    `🔔 Напоминания ${enabled ? 'включены' : 'выключены'}\nЧасовой пояс: ${metadata.timezone || 'не задан'}\n\nСообщения со списком дел будут приходить в выбранное время.`,
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
    return await ctx.reply('Сначала выбери часовой пояс в настройках.');
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
    .text('🏠 Меню', 'menu:home');
  await ctx.reply(`${task.name}\n${QUADRANTS[getQuadrant(task) - 1]}`, {
    reply_markup: keyboard,
  });
};

export const registerMenu = (composer: Composer<BotContext>) => {
  composer.on('message:text', async (ctx, next) => {
    if (ctx.chat.type !== 'private') return next();
    const text = ctx.message.text.trim();
    try {
      if (Object.values(MENU).some((label) => label === text)) {
        ctx.session.awaitingAdd = undefined;
        ctx.session.editScene = undefined;
        if (text === MENU.home) return await menuCommand(ctx);
        if (text === MENU.settings) {
          newState(ctx);
          return await ctx.reply('⚙️ Настройки', {
            reply_markup: settingsKeyboard(),
          });
        }
        if (text === MENU.now) {
          newState(ctx);
          return await showNow(ctx);
        }
        if (text === MENU.add) {
          newState(ctx).input = 'brain';
          return await ctx.reply(
            'Напиши дела одним сообщением или отправь ГС. Для отмены нажми «🏠 Меню».',
          );
        }
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
        return await ctx.reply(
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
      ctx.session.edit…3209 tokens truncated…3eизойдёт только после подтверждения.',
  ]);
  for (let index = 0; index < messages.length; index++) {
    await ctx.reply(
      messages[index],
      index === messages.length - 1
        ? {
            reply_markup: new InlineKeyboard()
              .text('🗑️ Удалить', `del_yes:${id}`)
              .text('Отмена', `del_no:${id}`),
          }
        : {},
    );
  }
};

export const removeByNumbers = async (ctx: BotContext, input: string) => {
  try {
    if (ctx.chat?.type !== 'private')
      return await ctx.reply('Удаляй по номерам в личном чате.');
    const tasks = getNumberedTasks(ctx.from!.id, ctx.chat.id);
    if (!tasks)
      return await ctx.reply(
        'Сначала открой /list или /today — номера относятся к последнему показанному списку.',
      );
    const numbers = parseTaskNumbers(input);
    if (numbers.some((number) => number > tasks.length))
      return await ctx.reply(
        'Такого номера нет в последнем списке. Проверь /list.',
      );
    await previewRemoval(
      ctx,
      numbers.map((number) => tasks[number - 1]),
    );
  } catch (error) {
    logAndReplyError(
      ctx,
      'REMOVE_NUMBERS',
      error,
      'Не удалось выбрать дела. Обнови /list и используй /remove 1 3.',
    );
  }
};

export const removeByVoice = async (ctx: BotContext, transcript: string) => {
  try {
    const { taskData } = await queryTasks();
    const snapshot = getNumberedTasks(ctx.from!.id, ctx.chat!.id);
    const tasks =
      snapshot ??
      numberedTasks([...taskData.uncompleted, ...taskData.completed]);
    const selection = await generateVoiceRemoval(transcript, tasks);
    if (selection.mode !== 'delete')
      return await ctx.reply(
        'Скажи отдельно, какие дела удалить, без добавления новых: «удали дело про продукты» или «удали первое и третье».',
      );
    if (selection.byNumber && !snapshot)
      return await ctx.reply('Для удаления по номерам сначала открой /list.');
    if (selection.numbers.some((number) => number > tasks.length))
      return await ctx.reply(
        'Не распознал номера. Обнови /list и попробуй ещё раз.',
      );
    await previewRemoval(
      ctx,
      selection.numbers.map((number) => tasks[number - 1]),
    );
  } catch (error) {
    logAndReplyError(
      ctx,
      'REMOVE_VOICE',
      error,
      '❌ Не удалось разобрать удаление. Ничего не удалено. Можно использовать /remove 1 3 после /list.',
    );
  }
};

export const registerSelectedRemoval = (composer: Composer<BotContext>) => {
  composer.callbackQuery(/^del_(yes|no):(.+)$/, async (ctx) => {
    const id = ctx.match[2];
    const draft = pending.get(id);
    if (
      !draft ||
      draft.owner !== ctx.from.id ||
      draft.chat !== ctx.chat?.id ||
      draft.expires < Date.now()
    ) {
      await ctx.answerCallbackQuery({
        text: 'Подтверждение устарело. Выбери дела заново.',
      });
      return;
    }
    if (draft.saving) {
      await ctx.answerCallbackQuery({ text: 'Уже удаляю…' });
      return;
    }
    if (ctx.match[1] === 'yes') draft.saving = true;
    await ctx.answerCallbackQuery();
    if (ctx.match[1] === 'no') {
      pending.delete(id);
      await ctx.editMessageText('Отменено. Дела сохранены.');
      return;
    }
    draft.saving = true;
    try {
      const { taskData, metadata } = await queryTasks();
      const updated = removeSelectedTasks(taskData, draft.tasks);
      if (!(await saveTasks(updated, metadata)))
        throw new Error('Save not confirmed');
      pending.delete(id);
      await ctx.editMessageText(
        `✅ Удалено дел: ${draft.tasks.length}.\nОткрой /list для новых номеров.`,
      );
      const ops = draft.tasks
        .filter((task) => task.calendarEventId)
        .map((task) => ({
          type: 'remove' as const,
          taskName: task.name,
          calendarEventId: task.calendarEventId,
        }));
      if (ops.length)
        await promptCalendarAction(
          ctx,
          'Удалить связанные события Google Calendar?',
          ops,
        );
    } catch (error) {
      draft.saving = false;
      logAndReplyError(
        ctx,
        'REMOVE_CONFIRM',
        error,
        '❌ Не удалось подтвердить удаление: список мог измениться. Проверь /list и выбери дела заново.',
      );
    }
  });
};
