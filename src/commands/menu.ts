import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { type Composer, InlineKeyboard } from 'grammy';
import type { Task } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { enterEditScene } from '../scenes/editTaskScene.js';
import { panelNotice, panelReply } from '../services/chatPanel.js';
import { QUADRANTS, setQuadrant } from '../services/eisenhower.js';
import {
  normalizeFireTvHost,
  parseFireTvMedia,
  wakeFireTv,
} from '../services/fireTv.js';
import {
  DEFAULT_MORNING_ITEMS,
  morningDone,
  morningItems,
  morningKeyboard,
  morningText,
} from '../services/morningChecklist.js';
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
  input?:
    | 'brain'
    | 'time'
    | 'wake-weekday'
    | 'wake-friday'
    | 'wake-sober'
    | 'wake-drinking'
    | 'morning-add'
    | 'morning-edit'
    | 'tv-host'
    | 'tv-add';
  morningIndex?: number;
  media?: string[];
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

const showWakeSettings = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const time = metadata.wake_weekday_time || '08:00';
  const fridayTime = metadata.wake_friday_prompt_time || '21:00';
  const soberTime = metadata.wake_weekend_sober_time || '09:00';
  const drinkingTime = metadata.wake_weekend_drinking_time || '10:00';
  const state = newState(ctx);
  const { timezone, wake_weekend_mode, wake_weekend_mode_week } = metadata;
  const today = timezone
    ? formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
    : '';
  const weekday = timezone
    ? Number(formatInTimeZone(new Date(), timezone, 'i'))
    : undefined;
  const weekendFriday =
    weekday === undefined
      ? ''
      : (() => {
          const friday = new Date(`${today}T12:00:00Z`);
          friday.setUTCDate(
            friday.getUTCDate() -
              (weekday === 6
                ? 1
                : weekday === 7
                  ? 2
                  : weekday === 5
                    ? 0
                    : (weekday + 2) % 7),
          );
          return friday.toISOString().slice(0, 10);
        })();
  const weekendStatus =
    wake_weekend_mode_week === weekendFriday
      ? wake_weekend_mode === 'sober'
        ? `На ближайшие выходные выбран подъём в ${soberTime}.`
        : `На ближайшие выходные выбран подъём в ${drinkingTime}.`
      : `В пятницу в ${fridayTime} спрошу про планы и выберу время на выходные.`;
  const keyboard = new InlineKeyboard()
    .text('⏪ На 15 мин раньше', `menu:wakeearlier:${state.id}`)
    .row()
    .text('⏩ На 15 мин позже', `menu:wakelater:${state.id}`)
    .row()
    .text('↩️ Вернуть 08:00', `menu:wakereset:${state.id}`)
    .row()
    .text('✏️ Ввести подъём в будни', `menu:wakeinput:${state.id}:weekday`)
    .row()
    .text(
      `✏️ Пятничный вопрос · ${fridayTime}`,
      `menu:wakeinput:${state.id}:friday`,
    )
    .row()
    .text(
      `✏️ Выходной без алкоголя · ${soberTime}`,
      `menu:wakeinput:${state.id}:sober`,
    )
    .row()
    .text(
      `✏️ Выходной после алкоголя · ${drinkingTime}`,
      `menu:wakeinput:${state.id}:drinking`,
    )
    .row()
    .text('⬅️ Настройки', 'menu:settings')
    .text('🏠 Меню', 'menu:home');
  await panelReply(
    ctx,
    `⏰ Режим подъёма\n\nБудни: ${time} (цель — 07:00). Сдвигай постепенно шагами по 15 минут или введи время вручную.\nВыходные: ${weekendStatus}\nЕсли не пьёшь — подъём в ${soberTime}; если пьёшь или не ответил — в ${drinkingTime}.\nПятничный вопрос — в ${fridayTime}.\nЧасовой пояс: ${timezone || 'сначала задай в настройках'}.`,
    { reply_markup: keyboard },
  );
};

const showMorningSettings = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const items = morningItems(metadata);
  const state = newState(ctx);
  const enabled = metadata.morning_enabled !== 'false';
  const keyboard = new InlineKeyboard()
    .text(
      enabled ? '🔕 Выключить' : '🔔 Включить',
      `menu:morningtoggle:${state.id}`,
    )
    .row();
  items.forEach((_, index) => {
    keyboard
      .text(`✏️ ${index + 1}`, `menu:morningedit:${state.id}:${index}`)
      .text(`🗑 ${index + 1}`, `menu:morningdelete:${state.id}:${index}`)
      .row();
  });
  if (items.length < 8)
    keyboard.text('➕ Добавить пункт', `menu:morningadd:${state.id}`).row();
  keyboard
    .text('↩️ Вернуть стандартный список', `menu:morningreset:${state.id}`)
    .row()
    .text('⬅️ Настройки', 'menu:settings')
    .text('🏠 Меню', 'menu:home');
  await panelReply(
    ctx,
    `☀️ Утренний список ${enabled ? 'включён' : 'выключен'}\n\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nВ будни появляется в заданное время подъёма и удаляется через час. Изменения пунктов начнут действовать следующим утром.`,
    { reply_markup: keyboard },
  );
};

const saveMorningInput = async (
  ctx: BotContext,
  state: MenuState,
  text: string,
) => {
  if (text.length > 60 || !text.trim() || /[\r\n]/.test(text))
    return await panelReply(
      ctx,
      'Напиши один пункт длиной от 1 до 60 символов.',
    );
  const { taskData, metadata } = await queryTasks();
  const items = morningItems(metadata);
  if (state.input === 'morning-add') {
    if (items.length >= 8) return await showMorningSettings(ctx);
    items.push(text.trim());
  } else {
    const index = state.morningIndex;
    if (index === undefined || index < 0 || index >= items.length)
      return await showMorningSettings(ctx);
    items[index] = text.trim();
  }
  metadata.morning_items = JSON.stringify(items);
  state.input = undefined;
  state.morningIndex = undefined;
  if (!(await saveTasks(taskData, metadata)))
    throw new Error('Morning list was not saved');
  await showMorningSettings(ctx);
};

const saveWakeInput = async (
  ctx: BotContext,
  state: MenuState,
  raw: string,
) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw))
    return await panelReply(
      ctx,
      'Введи время в формате HH:MM, например 07:30.',
    );
  const { taskData, metadata } = await queryTasks();
  if (!metadata.timezone)
    return await panelReply(ctx, 'Сначала выбери часовой пояс в настройках.');
  const field = (
    {
      'wake-weekday': 'wake_weekday_time',
      'wake-friday': 'wake_friday_prompt_time',
      'wake-sober': 'wake_weekend_sober_time',
      'wake-drinking': 'wake_weekend_drinking_time',
    } as const
  )[
    state.input as
      | 'wake-weekday'
      | 'wake-friday'
      | 'wake-sober'
      | 'wake-drinking'
  ];
  if (state.input === 'wake-weekday' && (raw < '07:00' || raw > '08:00'))
    return await panelReply(
      ctx,
      'Будний подъём пока настраиваем в диапазоне 07:00–08:00.',
    );
  metadata[field] = raw;
  state.input = undefined;
  await saveTasks(taskData, metadata);
  await showWakeSettings(ctx);
};

const adjustWakeTime = async (
  ctx: BotContext,
  action: 'earlier' | 'later' | 'reset',
) => {
  const { taskData, metadata } = await queryTasks();
  if (!metadata.timezone)
    return await panelReply(ctx, 'Сначала выбери часовой пояс в настройках.');
  let time = metadata.wake_weekday_time || '08:00';
  if (action === 'reset') time = '08:00';
  else {
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const adjusted = Math.min(
      8 * 60,
      Math.max(7 * 60, minutes + (action === 'earlier' ? -15 : 15)),
    );
    time = `${String(Math.floor(adjusted / 60)).padStart(2, '0')}:${String(adjusted % 60).padStart(2, '0')}`;
  }
  metadata.wake_weekday_time = time;
  await saveTasks(taskData, metadata);
  await showWakeSettings(ctx);
};

const showFireTvSettings = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const host = metadata.fire_tv_host || '';
  const media = metadata.fire_tv_media
    ? parseFireTvMedia(metadata.fire_tv_media)
    : [];
  const enabled = metadata.fire_tv_enabled === 'true';
  const state = newState(ctx);
  const keyboard = new InlineKeyboard()
    .text('🌐 Указать IP', `menu:tvhost:${state.id}`)
    .row()
    .text('✏️ Изменить музыку', `menu:tvmusic:${state.id}`)
    .row()
    .text('▶️ Проверить видео на ТВ', `menu:tvtest:${state.id}`)
    .row()
    .text(
      enabled ? '⏸ Выключить запуск по расписанию' : '▶️ Включить по расписанию',
      `menu:tvtoggle:${state.id}`,
    )
    .row()
    .text('⬅️ Настройки', 'menu:settings')
    .text('🏠 Меню', 'menu:home');
  await panelReply(
    ctx,
    `📺 Утренний телевизор\n\nIP: ${host || 'не задан'}\nЗапуск по расписанию: ${enabled ? 'включён' : 'выключен'}\nВидео в списке: ${media.length}\n\nВ час подъёма бот разбудит телевизор и откроет случайное видео из списка. Оставь IP телевизора закреплённым в домашней сети.`,
    { reply_markup: keyboard },
  );
};

const showFireTvMusic = async (ctx: BotContext, showList = false) => {
  const { metadata } = await queryTasks();
  const media = metadata.fire_tv_media
    ? parseFireTvMedia(metadata.fire_tv_media)
    : [];
  const state = newState(ctx);
  const keyboard = new InlineKeyboard()
    .text('🎵 Актуальный список', `menu:tvlist:${state.id}`)
    .row()
    .text('➕ Добавить', `menu:tvadd:${state.id}`)
    .text('🗑 Удалить', `menu:tvdelete:${state.id}`)
    .row()
    .text('⬅️ Телевизор', 'menu:tv')
    .text('🏠 Меню', 'menu:home');
  await panelReply(
    ctx,
    showList
      ? `🎵 Актуальный список (${media.length})\n\n${media.length ? media.map((url, index) => `${index + 1}. ${url}`).join('\n') : 'Пока пусто.'}`
      : `🎵 Музыка для утреннего телевизора\n\nВидео в списке: ${media.length}. Что делаем?`,
    { reply_markup: keyboard },
  );
};

const showFireTvDelete = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  const media = metadata.fire_tv_media
    ? parseFireTvMedia(metadata.fire_tv_media)
    : [];
  if (!media.length) return await showFireTvMusic(ctx, true);
  const state = newState(ctx);
  state.media = media;
  const keyboard = new InlineKeyboard();
  media.forEach((_, index) => {
    keyboard
      .text(String(index + 1), `menu:tvremove:${state.id}:${index}`)
      .row();
  });
  keyboard.text('⬅️ Назад', 'menu:tvmusic').text('🏠 Меню', 'menu:home');
  await panelReply(
    ctx,
    `🗑 Какую строку удалить?\n\n${media.map((url, index) => `${index + 1}. ${url}`).join('\n')}`,
    { reply_markup: keyboard },
  );
};

const saveFireTvInput = async (
  ctx: BotContext,
  state: MenuState,
  raw: string,
) => {
  const { taskData, metadata } = await queryTasks();
  const editingHost = state.input === 'tv-host';
  if (editingHost) {
    metadata.fire_tv_host = normalizeFireTvHost(raw);
  } else {
    const existing = metadata.fire_tv_media
      ? parseFireTvMedia(metadata.fire_tv_media)
      : [];
    const added = parseFireTvMedia(raw);
    if (!added.length)
      return await panelReply(ctx, 'Отправь хотя бы одну YouTube-ссылку.');
    const urls = [...new Set([...existing, ...added])];
    if (urls.length > 20)
      return await panelReply(ctx, 'В списке может быть не больше 20 видео.');
    metadata.fire_tv_media = urls.join('\n');
  }
  state.input = undefined;
  if (!(await saveTasks(taskData, metadata)))
    throw new Error('TV settings were not saved');
  if (editingHost) await showFireTvSettings(ctx);
  else await showFireTvMusic(ctx, true);
};

const testFireTv = async (ctx: BotContext) => {
  const { metadata } = await queryTasks();
  if (!metadata.fire_tv_host)
    return await panelReply(ctx, 'Сначала укажи локальный IP телевизора.');
  try {
    const links = metadata.fire_tv_media
      ? parseFireTvMedia(metadata.fire_tv_media)
      : [];
    const selected = await wakeFireTv(metadata.fire_tv_host, links);
    await panelReply(
      ctx,
      selected
        ? `📺 Телевизор включён. Команда запуска видео отправлена: ${selected}\n\nПроверь, появилось ли видео на экране.`
        : '📺 Телевизор включён. Список видео пуст — добавь ссылку через «✏️ Изменить музыку», затем повтори проверку.',
    );
  } catch (error) {
    const detail =
      error instanceof Error && error.message.includes('ENOENT')
        ? 'Не найден adb на устройстве, где запущен бот. Проверь путь FIRE_TV_ADB_PATH.'
        : error instanceof Error && error.message.includes('открыть видео')
          ? 'ADB подключился, но телевизор не открыл ссылку. Проверь, что приложение YouTube установлено, и попробуй другую ссылку.'
          : 'Не удалось подключиться. Проверь IP, ADB Debugging и подтверждение доступа на экране телевизора.';
    await panelReply(ctx, `❌ ${detail}`);
  }
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
      if (state.input?.startsWith('wake-'))
        return await saveWakeInput(ctx, state, text);
      if (state.input?.startsWith('morning-'))
        return await saveMorningInput(ctx, state, text);
      if (state.input?.startsWith('tv-'))
        return await saveFireTvInput(ctx, state, text);
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
      if (action === 'wake') return await showWakeSettings(ctx);
      if (action === 'morning') return await showMorningSettings(ctx);
      if (action === 'tv') return await showFireTvSettings(ctx);
      if (action === 'tvmusic' || action === 'tvmedia')
        return await showFireTvMusic(ctx);
      if (action === 'tvlist') return await showFireTvMusic(ctx, true);
      if (action === 'tvdelete') return await showFireTvDelete(ctx);
      if (action === 'tvremove') {
        const snapshot = state?.media;
        if (!snapshot || !/^(?:0|[1-9]\d*)$/.test(value || ''))
          return await showFireTvMusic(ctx, true);
        const { taskData, metadata } = await queryTasks();
        const live = metadata.fire_tv_media
          ? parseFireTvMedia(metadata.fire_tv_media)
          : [];
        if (
          live.length !== snapshot.length ||
          live.some((url, index) => url !== snapshot[index])
        )
          return await showFireTvMusic(ctx, true);
        const index = Number(value);
        if (index >= live.length) return await showFireTvMusic(ctx, true);
        live.splice(index, 1);
        metadata.fire_tv_media = live.join('\n');
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('TV music deletion was not saved');
        return await showFireTvMusic(ctx, true);
      }
      if (action === 'wakeinput') {
        if (
          !['weekday', 'friday', 'sober', 'drinking'].includes(value || '') ||
          !state
        )
          return;
        state.input = `wake-${value}` as MenuState['input'];
        return await panelReply(
          ctx,
          `Введи время в формате HH:MM.${value === 'weekday' ? ' Для будней — от 07:00 до 08:00.' : ''}`,
          { reply_markup: navigationKeyboard('menu:wake') },
        );
      }
      if (action === 'morningadd' || action === 'morningedit') {
        if (!state) return;
        const items = morningItems((await queryTasks()).metadata);
        const index = Number(value);
        if (
          action === 'morningedit' &&
          (!Number.isInteger(index) || index < 0 || index >= items.length)
        )
          return await showMorningSettings(ctx);
        state.input = action === 'morningadd' ? 'morning-add' : 'morning-edit';
        state.morningIndex = action === 'morningedit' ? index : undefined;
        return await panelReply(
          ctx,
          action === 'morningadd'
            ? 'Напиши новый пункт утреннего списка.'
            : `Замени пункт «${items[index]}»: напиши новый текст.`,
          { reply_markup: navigationKeyboard('menu:morning') },
        );
      }
      if (
        action === 'morningdelete' ||
        action === 'morningreset' ||
        action === 'morningtoggle'
      ) {
        const { taskData, metadata } = await queryTasks();
        if (action === 'morningtoggle') {
          metadata.morning_enabled =
            metadata.morning_enabled === 'false' ? 'true' : 'false';
        } else if (action === 'morningreset') {
          metadata.morning_items = JSON.stringify(DEFAULT_MORNING_ITEMS);
        } else {
          const items = morningItems(metadata);
          const index = Number(value);
          if (!Number.isInteger(index) || index < 0 || index >= items.length)
            return await showMorningSettings(ctx);
          if (items.length === 1)
            return await panelReply(
              ctx,
              'Оставь хотя бы один пункт в списке.',
              {
                reply_markup: navigationKeyboard('menu:morning'),
              },
            );
          items.splice(index, 1);
          metadata.morning_items = JSON.stringify(items);
        }
        if (!(await saveTasks(taskData, metadata)))
          throw new Error('Morning settings were not saved');
        return await showMorningSettings(ctx);
      }
      if (action === 'tvhost' || action === 'tvadd') {
        if (!state) return;
        state.input = action === 'tvhost' ? 'tv-host' : 'tv-add';
        return await panelReply(
          ctx,
          action === 'tvhost'
            ? 'Отправь локальный IPv4 телевизора, например 192.168.1.50.'
            : 'Отправь YouTube-ссылки, каждую с новой строки. Добавлю их к текущему списку (максимум 20).',
          {
            reply_markup: navigationKeyboard(
              action === 'tvhost' ? 'menu:tv' : 'menu:tvmusic',
            ),
          },
        );
      }
      if (action === 'tvtest') return await testFireTv(ctx);
      if (action === 'tvtoggle') {
        if (!state) return;
        const { taskData, metadata } = await queryTasks();
        if (!metadata.fire_tv_host)
          return await panelReply(
            ctx,
            'Сначала укажи локальный IP телевизора.',
          );
        metadata.fire_tv_enabled =
          metadata.fire_tv_enabled === 'true' ? 'false' : 'true';
        await saveTasks(taskData, metadata);
        return await showFireTvSettings(ctx);
      }
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
      if (action === 'wakeearlier') return await adjustWakeTime(ctx, 'earlier');
      if (action === 'wakelater') return await adjustWakeTime(ctx, 'later');
      if (action === 'wakereset') return await adjustWakeTime(ctx, 'reset');
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

  composer.callbackQuery(/^wake:(yes|no)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCallbackQuery({ text: 'Открой личный чат с ботом.' });
      return;
    }
    try {
      const { taskData, metadata } = await queryTasks();
      if (!metadata.timezone) {
        await ctx.answerCallbackQuery({ text: 'Сначала задай часовой пояс.' });
        return;
      }
      const date = formatInTimeZone(
        new Date(),
        metadata.timezone,
        'yyyy-MM-dd',
      );
      const weekday = Number(
        formatInTimeZone(new Date(), metadata.timezone, 'i'),
      );
      if (weekday < 5 || weekday > 7) {
        await ctx.answerCallbackQuery({ text: 'Этот вопрос уже устарел.' });
        return;
      }
      const friday = new Date(`${date}T12:00:00Z`);
      friday.setUTCDate(
        friday.getUTCDate() - (weekday === 6 ? 1 : weekday === 7 ? 2 : 0),
      );
      metadata.wake_weekend_mode = ctx.match[1] === 'no' ? 'sober' : 'drinking';
      metadata.wake_weekend_mode_week = friday.toISOString().slice(0, 10);
      await saveTasks(taskData, metadata);
      const weekendWakeTime =
        ctx.match[1] === 'no'
          ? metadata.wake_weekend_sober_time || '09:00'
          : metadata.wake_weekend_drinking_time || '10:00';
      await ctx.answerCallbackQuery({
        text:
          ctx.match[1] === 'no'
            ? `Окей, подъём в ${weekendWakeTime}.`
            : `Понял, подъём в ${weekendWakeTime}.`,
      });
      await panelReply(
        ctx,
        ctx.match[1] === 'no'
          ? `🌿 Записал: на эти выходные ставлю подъём на ${weekendWakeTime}.`
          : `🍻 Записал: на эти выходные ставлю подъём на ${weekendWakeTime}. Береги себя.`,
      );
    } catch (error) {
      logAndReplyError(
        ctx,
        'WAKE_ANSWER',
        error,
        'Не получилось сохранить ответ.',
      );
    }
  });

  composer.callbackQuery(/^morning:(\d{4}-\d{2}-\d{2}):(\d)$/, async (ctx) => {
    if (ctx.chat?.type !== 'private' || ctx.chat.id !== ctx.from.id) {
      await ctx.answerCallbackQuery({ text: 'Открой личный чат с ботом.' });
      return;
    }
    try {
      const { taskData, metadata } = await queryTasks();
      const items = morningItems({
        morning_items: metadata.morning_active_items,
      });
      const index = Number(ctx.match[2]);
      const expires = Date.parse(metadata.morning_expires_at || '');
      if (
        metadata.morning_enabled === 'false' ||
        metadata.morning_active_date !== ctx.match[1] ||
        metadata.morning_message_id !==
          String(ctx.callbackQuery.message?.message_id) ||
        !Number.isFinite(expires) ||
        Date.now() >= expires ||
        index >= items.length
      ) {
        await ctx.answerCallbackQuery({
          text: 'Этот утренний список уже закрыт.',
        });
        return;
      }
      await ctx.answerCallbackQuery();
      const done = morningDone(metadata, items.length);
      const next = done.includes(index)
        ? done.filter((item) => item !== index)
        : [...done, index].sort((a, b) => a - b);
      metadata.morning_done = JSON.stringify(next);
      if (!(await saveTasks(taskData, metadata)))
        throw new Error('Morning progress was not saved');
      await ctx.api.editMessageText(
        ctx.chat.id,
        Number(metadata.morning_message_id),
        morningText(
          items,
          next,
          metadata.morning_wake_time || metadata.wake_weekday_time || '08:00',
          metadata.morning_note || '',
        ),
        { reply_markup: morningKeyboard(ctx.match[1], items, next) },
      );
    } catch (error) {
      logAndReplyError(
        ctx,
        'MORNING_CHECKLIST',
        error,
        'Не удалось обновить утренний список.',
      );
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
