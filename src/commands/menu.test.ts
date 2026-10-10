import { afterEach, expect, setSystemTime, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bot } from 'grammy';
import { registerTaskPickerAction } from '../actions/taskPicker.js';
import * as aiClient from '../clients/ai.js';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { editSceneComposer } from '../scenes/editTaskScene.js';
import { AssistantHistory } from '../services/assistantHistory.js';
import {
  getKeyboardAction,
  registerContextKeyboard,
} from '../services/contextKeyboard.js';
import {
  PendingInputStore,
  registerPendingInputs,
  retryPendingInputsOnce,
} from '../services/pendingInputs.js';
import { checkReminders } from '../services/reminders.js';
import { GitHubStorageProvider } from '../services/storage/GitHubStorageProvider.js';
import { MENU } from '../views/menuView.js';
import { registerAiSettings } from './aiSettings.js';
import { registerAssistant } from './assistant.js';
import { registerBrainActions } from './brain.js';
import { completeCommand } from './complete.js';
import { registerDayPlanner } from './day.js';
import { registerMenu } from './menu.js';
import { registerSelectedRemoval } from './removeSelected.js';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const fixture = (user: number) => {
  let data: { taskData: TaskData; metadata: Metadata } = {
    taskData: {
      completed: [],
      uncompleted: [
        { name: 'Первое', completed: false, tags: [] },
        { name: 'Второе', completed: false, tags: [] },
      ],
    },
    metadata: { timezone: 'Europe/Berlin', reminder_times: '09:00,19:00' },
  };
  spies.push(
    spyOn(GitHubStorageProvider.prototype, 'queryTasks').mockImplementation(
      async () => structuredClone(data),
    ),
  );
  spies.push(
    spyOn(GitHubStorageProvider.prototype, 'saveTasks').mockImplementation(
      async (taskData, metadata) => {
        data = structuredClone({ taskData, metadata });
        return true;
      },
    ),
  );
  const bot = new Bot<BotContext>('123:test', {
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });
  const calls: Array<Record<string, unknown>> = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, ...payload });
    return {
      ok: true,
      result:
        method === 'sendMessage'
          ? {
              message_id: calls.length,
              date: 0,
              chat: { id: user, type: 'private' },
              text: 'test',
            }
          : method === 'getFile'
            ? { file_path: 'documents/table.csv' }
            : true,
    } as Awaited<ReturnType<typeof _prev>>;
  });
  const session = {};
  bot.use(async (ctx, next) => {
    ctx.session = session;
    await next();
  });
  registerContextKeyboard(bot);
  registerAiSettings(bot);
  registerDayPlanner(bot);
  registerMenu(bot);
  registerPendingInputs(bot);
  registerBrainActions(bot);
  registerSelectedRemoval(bot);
  registerTaskPickerAction(bot);
  bot.command('complete', completeCommand);
  bot.use(editSceneComposer);
  registerAssistant(bot);
  const from = { id: user, is_bot: false, first_name: 'User' };
  const message = {
    message_id: 1,
    date: 0,
    chat: { id: user, type: 'private' as const, first_name: 'User' },
    from,
    text: '',
  };
  let update = 1;
  const text = async (value: string) => {
    await bot.handleUpdate({
      update_id: update++,
      message: {
        ...message,
        text: value,
        entities: value.startsWith('/')
          ? [
              {
                type: 'bot_command',
                offset: 0,
                length: value.split(' ')[0].length,
              },
            ]
          : undefined,
      },
    });
  };
  const document = async (name = 'routine.csv') => {
    await bot.handleUpdate({
      update_id: update++,
      message: {
        message_id: message.message_id,
        date: message.date,
        chat: message.chat,
        from,
        document: {
          file_id: 'table',
          file_unique_id: 'table',
          file_name: name,
          file_size: 100,
        },
      },
    });
  };
  const click = async (value: string) => {
    await bot.handleUpdate({
      update_id: update++,
      callback_query: {
        id: String(update),
        from,
        chat_instance: 'test',
        message,
        data: value,
      },
    });
  };
  const button = (label: string): string => {
    const call = [...calls]
      .reverse()
      .find(
        (call) =>
          call.reply_markup && 'keyboard' in (call.reply_markup as object),
      );
    const markup = call?.reply_markup as
      | { keyboard: Array<Array<{ text: string }>> }
      | undefined;
    const found = markup?.keyboard
      .flat()
      .find((item) => item.text.includes(label));
    const action = found && getKeyboardAction(user, found.text);
    if (action) return action;
    throw new Error(`Button missing: ${label}`);
  };
  const labels = (): string[] => {
    const call = [...calls]
      .reverse()
      .find(
        (call) =>
          call.reply_markup && 'keyboard' in (call.reply_markup as object),
      );
    const markup = call?.reply_markup as
      | { keyboard: Array<Array<{ text: string }>> }
      | undefined;
    return markup?.keyboard.flat().map((item) => item.text) ?? [];
  };
  const tap = async (label: string) => {
    const value = labels().find((value) => value.includes(label));
    if (!value) throw new Error(`Button missing: ${label}`);
    await text(value);
  };
  return {
    bot,
    text,
    document,
    click,
    button,
    labels,
    tap,
    calls,
    data: () => data,
  };
};

test('reminder buttons preserve disabled schedule and restore it', async () => {
  const f = fixture(501);
  await f.click('menu:reminders');
  await f.click(f.button('Выключить'));
  expect(f.data().metadata.reminder_times).toBe('off');
  expect(f.data().metadata.reminder_saved_times).toBe('09:00,19:00');
  await f.click(f.button('Включить'));
  expect(f.data().metadata.reminder_times).toBe('09:00,19:00');
  await f.click(f.button('09:00 — изменить'));
  await f.click(f.button('Ввести HH:MM'));
  await f.text('08:20');
  expect(f.data().metadata.reminder_times).toBe('08:20,19:00');
});

test('task buttons keep their target after reordering and reject old cards', async () => {
  const f = fixture(502);
  await f.text(MENU.all);
  await f.click(f.button('1. Первое'));
  const done = f.button('Готово');
  f.data().taskData.uncompleted.reverse();
  await f.click(done);
  expect(f.data().taskData.completed[0].name).toBe('Первое');
  expect(f.data().taskData.uncompleted[0].name).toBe('Второе');
  await f.click(done);
  expect(f.data().taskData.completed).toHaveLength(1);
  expect(f.calls[f.calls.length - 1]?.text).toContain('устарело');
});

test('now button does not parse its label as a minutes argument; timezone button saves', async () => {
  const f = fixture(503);
  await f.text(MENU.now);
  expect(
    f.calls.some((call) => String(call.text).includes('Используй /now')),
  ).toBe(false);
  await f.click('menu:timezone');
  await f.click(f.button('Кишинёв'));
  expect(f.data().metadata.timezone).toBe('Europe/Chisinau');
});

test('AI settings save multiline rules, toggle auto and cancel rule entry', async () => {
  const f = fixture(504);
  await f.click('ai:open');
  await f.click(f.button('Мои правила'));
  await f.text('Учёба важна.\nСрочно только при дедлайне.');
  expect(f.data().metadata.ai_priority_rules).toBe(
    'Учёба важна.\nСрочно только при дедлайне.',
  );
  await f.click(f.button('Выключить авто'));
  expect(f.data().metadata.ai_auto_priority).toBe('off');
  await f.click(f.button('Мои правила'));
  await f.click('menu:settings');
  await f.text('Не сохранять это как правила');
  expect(f.data().metadata.ai_priority_rules).toBe(
    'Учёба важна.\nСрочно только при дедлайне.',
  );
});

test('manual importance locks a task and the card can unlock it', async () => {
  const f = fixture(505);
  await f.text(MENU.all);
  await f.click(f.button('1. Первое'));
  await f.click(f.button('Важность'));
  await f.click(f.button('Не важно и не срочно'));
  expect(f.data().taskData.uncompleted[0].priorityLocked).toBe(true);
  await f.click(f.button('Первое'));
  await f.click(f.button('Разрешить ИИ'));
  expect(f.data().taskData.uncompleted[0].priorityLocked).toBe(false);
});

test('existing task classification previews before saving and skips manual locks', async () => {
  const f = fixture(506);
  f.data().taskData.uncompleted[1].priorityLocked = true;
  const classification = spyOn(
    aiClient,
    'classifyTaskPriorities',
  ).mockImplementation(async (tasks) =>
    tasks.map((task) => ({ task, quadrant: 4, reason: 'Бытовая мелочь' })),
  );
  spies.push(classification);
  await f.click('ai:open');
  await f.click(f.button('Разобрать текущие дела'));
  expect(classification.mock.calls[0][0]).toHaveLength(1);
  expect(f.data().taskData.uncompleted[0].important).toBeUndefined();
  await f.click(f.button('Сохранить'));
  expect(f.data().taskData.uncompleted[0].important).toBe(false);
  expect(f.data().taskData.uncompleted[1].priorityLocked).toBe(true);
});

test('time navigation goes one step back and home clears pending input', async () => {
  const f = fixture(507);
  await f.click('menu:reminders');
  await f.click(f.button('09:00 — изменить'));
  await f.tap('▶️');
  await f.click(f.button('08'));
  await f.click(f.button('Назад'));
  expect(
    [...f.calls].reverse().find((call) => typeof call.text === 'string')?.text,
  ).toBe('Выбери час:');
  await f.click(f.button('Назад'));
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('Напоминания');
  await f.click(f.button('09:00 — изменить'));
  await f.click(f.button('Ввести HH:MM'));
  await f.click(f.button('🏠 Меню'));
  await f.text('08:20');
  expect(f.data().metadata.reminder_times).toBe('09:00,19:00');
});

test('task importance and removal go back without saving changes', async () => {
  const f = fixture(508);
  await f.text(MENU.all);
  await f.click(f.button('1. Первое'));
  await f.click(f.button('Важность'));
  await f.click(f.button('Назад'));
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('Первое');
  await f.click(f.button('Удалить'));
  await f.click(f.button('Назад'));
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('Первое');
  await f.click(f.button('Назад'));
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('Выбирай дело');
});

test('brain preview back cancels draft and restores add prompt', async () => {
  const f = fixture(509);
  const generation = spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
    { name: 'Новое', completed: false, tags: [] },
  ]);
  spies.push(generation);
  await f.text(MENU.add);
  await f.text('Новое');
  await f.click(f.button('Назад'));
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('Напиши дела');
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.click(f.button('🏠 Меню'));
  await f.text('Случайный текст');
  expect(generation).toHaveBeenCalledTimes(1);
});

test('brain sequential category review preserves numbers, locks choices and saves only on confirmation', async () => {
  const f = fixture(530);
  const generation = spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
    {
      name: 'Собрать вещи',
      completed: false,
      tags: [],
      important: true,
      urgent: false,
    },
    {
      name: 'Тренировка',
      completed: false,
      tags: [],
      important: false,
      urgent: false,
    },
  ]);
  spies.push(generation);
  await f.text(MENU.add);
  await f.text('Собрать вещи, тренировка');
  await f.tap('Разобрать по одному');
  expect(
    String([...f.calls].reverse().find((call) => call.text)?.text),
  ).toContain('Дело 1 из 2: Собрать вещи');
  await f.tap('Неважно, но срочно');
  expect(
    String([...f.calls].reverse().find((call) => call.text)?.text),
  ).toContain('Дело 2 из 2: Тренировка');
  await f.tap('Важно, не срочно');
  const preview = String(
    [...f.calls].reverse().find((call) => call.text)?.text,
  );
  expect(preview).toContain('1. ✅ Собрать вещи');
  expect(preview).toContain('2. ✅ Тренировка');
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.tap('Сохранить');
  const tasks = f.data().taskData.uncompleted;
  expect(tasks.find((task) => task.name === 'Собрать вещи')).toMatchObject({
    important: false,
    urgent: true,
    priorityLocked: true,
  });
  expect(tasks.find((task) => task.name === 'Тренировка')).toMatchObject({
    important: true,
    urgent: false,
    priorityLocked: true,
  });
  expect(generation).toHaveBeenCalledTimes(1);
});

test('individual draft review returns through picker and Home invalidates old category and save actions', async () => {
  const f = fixture(531);
  spies.push(
    spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
      { name: 'Мусор', completed: false, tags: [] },
    ]),
  );
  await f.text(MENU.add);
  await f.text('Мусор');
  const save = f.button('Сохранить');
  await f.tap('Изменить категорию');
  await f.tap('1. Мусор');
  const category = f.button('Неважно, но срочно');
  await f.tap('Назад');
  expect(f.labels()).toContain('1. Мусор');
  await f.tap('🏠 Меню');
  await f.click(category);
  await f.click(save);
  expect(f.data().taskData.uncompleted).toHaveLength(2);
});

test('edit input back restores fields and home exits the scene', async () => {
  const f = fixture(510);
  await f.text(MENU.all);
  await f.click(f.button('1. Первое'));
  await f.click(f.button('Изменить'));
  await f.click(f.button('Name'));
  await f.click(f.button('Назад'));
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('Выбери поле');
  await f.click(f.button('🏠 Меню'));
  await f.text('Случайный текст');
  expect(f.data().taskData.uncompleted[0].name).toBe('Первое');
});

test('home invalidates pending deletion even if an old button survives cleanup', async () => {
  const f = fixture(511);
  await f.text(MENU.all);
  await f.click(f.button('1. Первое'));
  await f.click(f.button('Удалить'));
  const confirm = f.button('Удалить');
  await f.click(f.button('🏠 Меню'));
  await f.click(confirm);
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  expect(
    String(
      [...f.calls].reverse().find((call) => typeof call.text === 'string')
        ?.text,
    ),
  ).toContain('устарело');
});

test('main keyboard has seven sections; settings replaces it and back restores it', async () => {
  const f = fixture(512);
  await f.text(MENU.home);
  expect(f.labels()).toEqual([
    MENU.today,
    MENU.all,
    MENU.add,
    MENU.now,
    MENU.settings,
    MENU.chat,
    MENU.plan,
  ]);
  await f.tap('Настройки');
  expect(f.labels()).toContain('🔔 Напоминания');
  expect(f.labels()).toContain('🧠 Приоритеты ИИ');
  expect(f.labels()).not.toContain(MENU.today);
  expect(f.labels()).not.toContain(MENU.remove);
  await f.tap('Напоминания');
  expect(f.labels()).toContain('🔕 Выключить');
  expect(f.labels()).not.toContain('🧠 Приоритеты ИИ');
  await f.tap('Назад');
  expect(f.labels()).toContain('🧠 Приоритеты ИИ');
  await f.tap('🏠 Меню');
  expect(f.labels()).toEqual([
    MENU.today,
    MENU.all,
    MENU.add,
    MENU.now,
    MENU.settings,
    MENU.chat,
    MENU.plan,
  ]);
});

test('task card bottom keyboard runs actions and list back without interpreting buttons as new tasks', async () => {
  const f = fixture(513);
  await f.text(MENU.all);
  await f.tap('1. Первое');
  expect(f.labels()).toContain('✅ Готово');
  expect(f.labels()).toContain('🗑 Удалить');
  expect(f.labels()).not.toContain(MENU.add);
  await f.tap('Важность');
  await f.tap('Не важно и не срочно');
  expect(f.data().taskData.uncompleted[0].important).toBe(false);
  expect(f.labels().some((label) => label.includes('Первое'))).toBe(true);
  await f.tap('Первое');
  await f.tap('Готово');
  expect(f.data().taskData.completed[0].name).toBe('Первое');
});

test('AI rules and time selection buttons work through actual keyboard text', async () => {
  const f = fixture(514);
  await f.text(MENU.settings);
  await f.tap('Приоритеты ИИ');
  await f.tap('Мои правила');
  await f.tap('Назад');
  expect(f.data().metadata.ai_priority_rules).toBeUndefined();
  await f.tap('Назад');
  await f.tap('Напоминания');
  await f.tap('09:00 — изменить');
  await f.tap('▶️');
  await f.tap('08');
  await f.tap('08:15');
  expect(f.data().metadata.reminder_times).toBe('08:15,19:00');
});

test('reminder deletion keyboard identifies the exact time instead of identical delete labels', async () => {
  const f = fixture(515);
  await f.click('menu:reminders');
  expect(f.labels()).toContain('🗑 09:00');
  expect(f.labels()).toContain('🗑 19:00');
  await f.tap('🗑 09:00');
  expect(f.data().metadata.reminder_times).toBe('19:00');
});

test('complete picker remains open across consecutive completions, with inline Back notice', async () => {
  const f = fixture(540);
  await f.text('/complete');
  await f.tap('Первое');
  expect(f.labels()).toContain('Второе');
  expect(f.labels()).not.toContain('Первое');
  const notice = [...f.calls]
    .reverse()
    .find((call) => String(call.text).includes('Выполнено: Первое'));
  expect(notice?.reply_markup).toEqual({
    inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'menu:home' }]],
  });
  expect(f.data().taskData.completed).toHaveLength(1);
  await f.tap('Второе');
  expect(f.data().taskData.uncompleted).toHaveLength(0);
  expect(f.data().taskData.completed).toHaveLength(2);
  expect(f.labels()).not.toContain('Второе');
  await f.click('menu:home');
  expect(f.labels()).toContain(MENU.all);
});

test('task card completion returns to remaining task picker instead of main menu', async () => {
  const f = fixture(541);
  await f.text(MENU.all);
  await f.tap('1. Первое');
  await f.tap('Готово');
  expect(f.labels()).toContain('1. Второе');
  expect(f.labels()).not.toContain(MENU.add);
  await f.tap('1. Второе');
  await f.tap('Готово');
  expect(f.data().taskData.uncompleted).toHaveLength(0);
});

test('completion on the last picker page returns to a valid remaining page', async () => {
  const f = fixture(542);
  f.data().taskData.uncompleted = Array.from({ length: 7 }, (_, index) => ({
    name: `Дело ${index + 1}`,
    completed: false,
    tags: [],
  }));
  await f.text('/complete');
  await f.tap('Next');
  await f.tap('Дело 7');
  expect(f.labels()).toContain('Дело 1');
  expect(f.labels()).not.toContain('Дело 7');
  expect(f.data().taskData.uncompleted).toHaveLength(6);
});

test('named completion keeps the picker and removes its old notice on navigation', async () => {
  const f = fixture(543);
  await f.text('/complete Первое');
  expect(f.labels()).toContain('Второе');
  const notice = [...f.calls]
    .reverse()
    .find((call) => String(call.text).includes('Выполнено: Первое'));
  const noticeId = f.calls.indexOf(notice!) + 1;
  await f.tap('Второе');
  expect(
    f.calls.some(
      (call) => call.method === 'deleteMessage' && call.message_id === noticeId,
    ),
  ).toBe(true);
});

test('confirmed deletion refreshes the task list and supports choosing another task', async () => {
  const f = fixture(550);
  await f.text(MENU.all);
  await f.tap('1. Первое');
  await f.tap('Удалить');
  await f.tap('Удалить');
  expect(f.data().taskData.uncompleted.map((task) => task.name)).toEqual([
    'Второе',
  ]);
  expect(f.labels()).toContain('1. Второе');
  await f.tap('1. Второе');
  expect(f.labels()).toContain('🗑 Удалить');
});

test('compact keyboards page through hours without losing actions or navigation', async () => {
  const f = fixture(551);
  await f.click('menu:reminders');
  await f.tap('09:00 — изменить');
  const assertRows = () => {
    const call = [...f.calls]
      .reverse()
      .find(
        (call) =>
          call.reply_markup && 'keyboard' in (call.reply_markup as object),
      );
    expect(
      (call!.reply_markup as { keyboard: unknown[] }).keyboard.length,
    ).toBeLessThanOrEqual(4);
  };
  assertRows();
  await f.tap('▶️');
  assertRows();
  await f.tap('08');
  await f.tap('08:15');
  expect(f.data().metadata.reminder_times).toBe('08:15,19:00');
});

test('failed AI input is durable and manual retry uses text without another transcription', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'brain-retry-'));
  const previous = process.env.PENDING_INPUTS_PATH;
  process.env.PENDING_INPUTS_PATH = join(directory, 'jobs.json');
  const f = fixture(560);
  const generation = spyOn(aiClient, 'generateBrainTasks').mockRejectedValue({
    statusCode: 429,
    data: { error: { code: 'insufficient_quota' } },
  });
  spies.push(generation);
  try {
    await f.text(MENU.add);
    await f.text('Купить продукты');
    const store = new PendingInputStore(process.env.PENDING_INPUTS_PATH);
    expect(store.read()[0]).toMatchObject({
      owner: 560,
      text: 'Купить продукты',
      next: 0,
    });
    generation.mockResolvedValue([
      { name: 'Купить продукты', completed: false, tags: ['покупки'] },
    ]);
    await f.tap('Повторить разбор');
    expect(generation).toHaveBeenCalledTimes(2);
    expect(store.read()).toEqual([]);
    expect(f.labels()).toContain('✅ Сохранить');
    expect(f.data().taskData.uncompleted).toHaveLength(2);
  } finally {
    if (previous === undefined) delete process.env.PENDING_INPUTS_PATH;
    else process.env.PENDING_INPUTS_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('background retry is allowlisted, produces only a draft, and Home pauses retry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'auto-retry-'));
  const previous = process.env.PENDING_INPUTS_PATH;
  const allowed = process.env.TELEGRAM_BOT_ALLOWLIST;
  process.env.PENDING_INPUTS_PATH = join(directory, 'jobs.json');
  process.env.TELEGRAM_BOT_ALLOWLIST = '561';
  const f = fixture(561);
  const generation = spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
    { name: 'Продукты', completed: false, tags: [] },
  ]);
  spies.push(generation);
  const store = new PendingInputStore(process.env.PENDING_INPUTS_PATH);
  const job = {
    id: 'auto',
    owner: 561,
    chat: 561,
    text: 'Продукты',
    mode: 'brain' as const,
    expires: Date.now() + 60000,
    next: 1,
    attempts: 0,
  };
  try {
    store.put(job);
    store.put({ ...job, id: 'foreign', owner: 999, chat: 999 });
    await retryPendingInputsOnce(f.bot);
    expect(generation).toHaveBeenCalledTimes(1);
    expect(f.labels()).toContain('✅ Сохранить');
    expect(store.read().map((item) => item.id)).toEqual(['foreign']);
    expect(f.data().taskData.uncompleted).toHaveLength(2);
    store.put(job);
    await f.text(MENU.home);
    expect(store.read().find((item) => item.id === 'auto')?.next).toBe(0);
    await retryPendingInputsOnce(f.bot);
    expect(generation).toHaveBeenCalledTimes(1);
  } finally {
    if (previous === undefined) delete process.env.PENDING_INPUTS_PATH;
    else process.env.PENDING_INPUTS_PATH = previous;
    if (allowed === undefined) delete process.env.TELEGRAM_BOT_ALLOWLIST;
    else process.env.TELEGRAM_BOT_ALLOWLIST = allowed;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('assistant conversation uses live tasks, remembers turns, clears memory and drafts only on request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'assistant-menu-'));
  const previous = process.env.ASSISTANT_HISTORY_PATH;
  process.env.ASSISTANT_HISTORY_PATH = join(directory, 'history.json');
  try {
    const f = fixture(570);
    const conversation = spyOn(
      aiClient,
      'generateAssistantReply',
    ).mockResolvedValue({
      reply: 'Начни с одного небольшого шага.',
      action: 'none',
      taskInput: '',
    });
    spies.push(conversation);
    await f.text(MENU.chat);
    await f.text('Сил мало, за что взяться?');
    expect(conversation.mock.calls[0][2].uncompleted[0].name).toBe('Первое');
    expect(f.data().taskData.uncompleted).toHaveLength(2);
    conversation.mockResolvedValue({
      reply: 'Подготовим черновик.',
      action: 'add',
      taskInput: 'Купить хлеб',
    });
    await f.text('Добавь купить хлеб');
    expect(conversation.mock.calls[1][1]).toHaveLength(2);
    expect(f.labels()).toContain('📝 Подготовить черновик');
    expect(f.data().taskData.uncompleted).toHaveLength(2);
    const generation = spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
      { name: 'Купить хлеб', completed: false, tags: [] },
    ]);
    spies.push(generation);
    await f.tap('Подготовить черновик');
    expect(generation).toHaveBeenCalledTimes(1);
    expect(f.data().taskData.uncompleted).toHaveLength(2);
    expect(f.labels()).toContain('✅ Сохранить');
    await f.text(MENU.chat);
    await f.tap('Забыть разговор');
    expect(new AssistantHistory().get(570, 570)).toEqual([]);
    await f.text(MENU.home);
    await f.text('Не должно уйти в разговор');
    expect(conversation).toHaveBeenCalledTimes(2);
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_HISTORY_PATH;
    else process.env.ASSISTANT_HISTORY_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Home during assistant generation suppresses late replies and memory writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'assistant-cancel-'));
  const previous = process.env.ASSISTANT_HISTORY_PATH;
  process.env.ASSISTANT_HISTORY_PATH = join(directory, 'history.json');
  try {
    const f = fixture(571);
    let finish!: (value: {
      reply: string;
      action: 'none';
      taskInput: string;
    }) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const conversation = spyOn(
      aiClient,
      'generateAssistantReply',
    ).mockImplementation(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    spies.push(conversation);
    await f.text(MENU.chat);
    const reply = f.text('Помоги');
    await ready;
    await f.text(MENU.home);
    finish({ reply: 'LATE RESPONSE', action: 'none', taskInput: '' });
    await reply;
    expect(f.calls.some((call) => call.text === 'LATE RESPONSE')).toBe(false);
    expect(new AssistantHistory().get(571, 571)).toEqual([]);
    expect(f.labels()).toContain(MENU.chat);
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_HISTORY_PATH;
    else process.env.ASSISTANT_HISTORY_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('deleting misrecognized draft tasks preserves other numbers and saves only the survivor', async () => {
  const f = fixture(580);
  spies.push(
    spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
      { name: 'Ошибка распознавания', completed: false, tags: [] },
      { name: 'Нужное дело', completed: false, tags: [] },
      { name: 'Ещё ошибка', completed: false, tags: [] },
    ]),
  );
  await f.text(MENU.add);
  await f.text('голосовой список');
  await f.tap('Разобрать по одному');
  const staleDelete = f.button('Удалить');
  await f.tap('Удалить');
  expect(
    String([...f.calls].reverse().find((call) => call.text)?.text),
  ).toContain('Дело 2 из 3: Нужное дело');
  await f.click(staleDelete);
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.tap('Важно, не срочно');
  await f.tap('Удалить');
  const preview = String(
    [...f.calls].reverse().find((call) => call.text)?.text,
  );
  expect(preview).toContain('2. ✅ Нужное дело');
  expect(preview).not.toContain('Ошибка распознавания');
  expect(preview).not.toContain('Ещё ошибка');
  await f.tap('Сохранить');
  expect(f.data().taskData.uncompleted).toHaveLength(3);
  expect(
    f.data().taskData.uncompleted.some((task) => task.name === 'Нужное дело'),
  ).toBe(true);
  expect(
    f.data().taskData.uncompleted.some((task) => task.name.includes('ошибка')),
  ).toBe(false);
});

test('delete picker removes the last draft task without saving and invalidates old save action', async () => {
  const f = fixture(581);
  spies.push(
    spyOn(aiClient, 'generateBrainTasks').mockResolvedValue([
      { name: 'Неправильно услышанное', completed: false, tags: [] },
    ]),
  );
  await f.text(MENU.add);
  await f.text('голосовой список');
  const staleSave = f.button('Сохранить');
  await f.tap('Удалить дело');
  await f.tap('1. Неправильно');
  expect(
    String([...f.calls].reverse().find((call) => call.text)?.text),
  ).toContain('Черновик пуст');
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.click(staleSave);
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.tap('Назад');
  expect(f.labels()).toContain(MENU.add);
});

test('completion replaces the visible list with fresh storage and rejects its old task buttons', async () => {
  const f = fixture(590);
  const listText = () =>
    String(
      [...f.calls]
        .reverse()
        .find(
          (call) =>
            call.text &&
            call.reply_markup &&
            'keyboard' in (call.reply_markup as object),
        )?.text,
    );
  await f.text(MENU.all);
  const oldButton = f.button('1. Первое');
  const oldList = [...f.calls]
    .reverse()
    .find((call) => String(call.text).includes('📚 Все дела'))!;
  const oldListId = f.calls.indexOf(oldList) + 1;
  await f.tap('1. Первое');
  f.data().taskData.uncompleted.push({
    name: 'Добавлено параллельно',
    completed: false,
    tags: [],
  });
  await f.tap('Готово');
  expect(listText()).toContain('📚 Все дела · 2');
  expect(listText()).toContain('Второе');
  expect(listText()).toContain('Добавлено параллельно');
  expect(listText()).not.toContain('Первое');
  expect(
    f.calls.some(
      (call) =>
        call.method === 'deleteMessage' && call.message_id === oldListId,
    ),
  ).toBe(true);
  await f.click(oldButton);
  expect(f.data().taskData.completed).toHaveLength(1);
});

test('editing a task returns to an updated Today list and keeps its task keyboard', async () => {
  const f = fixture(591);
  f.data().taskData.uncompleted[1].date = '2099-01-01';
  await f.text(MENU.today);
  await f.tap('1. Первое');
  await f.tap('Изменить');
  await f.tap('Tags');
  await f.text('#work');
  const list = [...f.calls]
    .reverse()
    .find(
      (call) =>
        call.text &&
        call.reply_markup &&
        'keyboard' in (call.reply_markup as object),
    );
  expect(String(list?.text)).toContain('📋 Сегодня');
  expect(String(list?.text)).toContain('#work');
  expect(String(list?.text)).not.toContain('Второе');
  expect(f.labels()).toContain('1. Первое');
  await f.tap('1. Первое');
  expect(f.labels()).toContain('✅ Готово');
});

test('importance changes refresh matrix ordering and selection numbers immediately', async () => {
  const f = fixture(592);
  await f.text(MENU.all);
  await f.tap('2. Второе');
  await f.tap('Важность');
  await f.tap('Важно и срочно');
  const list = [...f.calls]
    .reverse()
    .find(
      (call) =>
        call.text &&
        call.reply_markup &&
        'keyboard' in (call.reply_markup as object),
    );
  expect(String(list?.text)).toContain('🔴 Важно и срочно · 1\n1. Второе');
  expect(f.labels()).toContain('1. Второе');
  await f.tap('1. Второе');
  await f.tap('Готово');
  expect(f.data().taskData.completed[0].name).toBe('Второе');
});

test('editing a date out of Today shows an empty list without stale task buttons', async () => {
  const f = fixture(593);
  f.data().taskData.uncompleted[1].date = '2099-01-01';
  await f.text(MENU.today);
  await f.tap('1. Первое');
  await f.tap('Изменить');
  await f.tap('Date');
  await f.text('2099-01-02');
  const list = [...f.calls]
    .reverse()
    .find(
      (call) =>
        call.text &&
        call.reply_markup &&
        'keyboard' in (call.reply_markup as object),
    );
  expect(String(list?.text)).toContain('📋 Сегодня');
  expect(String(list?.text)).not.toContain('Первое');
  expect(f.labels().some((label) => label.includes('Первое'))).toBe(false);
});

test('day planner creates timed tasks only after confirmation and home invalidates an old save', async () => {
  const f = fixture(600);
  await f.text(MENU.plan);
  await f.tap('Дело со временем');
  await f.text('Работа над Kür');
  await f.tap('Завтра');
  await f.text('18:00-19:30');
  const oldSave = f.button('Сохранить');
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.tap('🏠 Меню');
  await f.click(oldSave);
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.text(MENU.plan);
  await f.tap('Дело со временем');
  await f.text('Работа над Kür');
  await f.tap('Завтра');
  await f.text('18:00-19:30');
  await f.tap('Сохранить');
  expect(
    f
      .data()
      .taskData.uncompleted.find((task) => task.name === 'Работа над Kür'),
  ).toMatchObject({ time: '18:00', duration: '01:30' });
});
test('planner weekly schedule and notification settings persist without mutating task contents', async () => {
  const f = fixture(601);
  await f.text(MENU.plan);
  await f.tap('Расписание');
  await f.tap('Занятые часы');
  await f.text('Лекции');
  await f.tap('Пн–Пт');
  await f.text('09:00-12:00');
  await f.tap('Сохранить');
  expect(
    JSON.parse(f.data().metadata.planner_preferences!).busy[0],
  ).toMatchObject({
    name: 'Лекции',
    days: [1, 2, 3, 4, 5],
    start: '09:00',
    end: '12:00',
  });
  await f.text(MENU.plan);
  await f.tap('Планировка');
  await f.tap('Утро и вечер');
  await f.text('08:00 21:00');
  expect(f.data().metadata.planner_notify_times).toBe('08:00,21:00');
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  await f.tap('Утро и вечер');
  await f.tap('Выключить');
  expect(f.data().metadata.planner_notify_times).toBe('off');
});

test('planner sends a morning plan and evening summary once per slot even with ordinary reminders off', async () => {
  const previous = process.env.TELEGRAM_BOT_ALLOWLIST;
  process.env.TELEGRAM_BOT_ALLOWLIST = '602';
  try {
    const f = fixture(602);
    f.data().metadata.planner_notify_times = '08:00,21:00';
    f.data().metadata.reminder_times = 'off';
    await checkReminders(f.bot, new Date('2026-10-09T06:00:00Z'));
    await checkReminders(f.bot, new Date('2026-10-09T06:01:00Z'));
    expect(
      f.calls.filter((call) => String(call.text).includes('Доброе утро')),
    ).toHaveLength(1);
    await checkReminders(f.bot, new Date('2026-10-09T19:00:00Z'));
    expect(
      f.calls.filter((call) => String(call.text).includes('Вечерний обзор')),
    ).toHaveLength(1);
    expect(f.data().metadata.planner_last_sent).toBe('2026-10-09T21:00');
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_BOT_ALLOWLIST;
    else process.env.TELEGRAM_BOT_ALLOWLIST = previous;
  }
});

test('next-step completion updates the daily tracker; explicit deferral and stale cards cannot complete the wrong task', async () => {
  setSystemTime(new Date('2026-10-09T10:00:00Z'));
  try {
    const f = fixture(603);
    await f.text(MENU.plan);
    await f.tap('Следующий шаг');
    const stale = f.button('Готово');
    await f.tap('Готово');
    expect(f.data().taskData.completed[0].name).toBe('Первое');
    expect(f.data().taskData.completed[0].log).toContain(
      'Completed 2026-10-09',
    );
    await f.tap('Следующий шаг');
    await f.tap('На завтра');
    expect(f.data().taskData.uncompleted[0].date).toBe('2026-10-10');
    await f.click(stale);
    expect(f.data().taskData.completed).toHaveLength(1);
    await f.text(MENU.plan);
    await f.tap('Итог дня');
    expect(
      String([...f.calls].reverse().find((call) => call.text)?.text),
    ).toContain('Завершено: 1');
  } finally {
    setSystemTime();
  }
});

test('routine templates edit, assign, unassign and delete with confirmed persistence', async () => {
  const f = fixture(610);
  const before = structuredClone(f.data().taskData);
  await f.text(MENU.plan);
  await f.tap('Планировка');
  await f.tap('Шаблоны');
  await f.tap('Учебный');
  expect(f.data().metadata.planner_preferences).toBeUndefined();
  await f.tap('Название');
  await f.text('Мой режим');
  await f.tap('Изменить блоки');
  await f.text('23:00-08:00 Сон\n08:00-08:30 Завтрак');
  await f.tap('Дни недели');
  await f.tap('Пн');
  // Seventh weekday and confirmation live on the second compact keyboard page.
  await f.tap('▶');
  await f.tap('Сохранить назначение');
  let preferences = JSON.parse(f.data().metadata.planner_preferences!);
  expect(preferences.weekTemplates).toEqual({ '1': 'study' });
  expect(preferences.templates[0].name).toBe('Мой режим');
  expect(preferences.templates[0].blocks).toHaveLength(2);
  await f.tap('Мой режим');
  await f.tap('Дни недели');
  await f.tap('Пн');
  await f.tap('▶');
  await f.tap('Сохранить назначение');
  preferences = JSON.parse(f.data().metadata.planner_preferences!);
  expect(preferences.weekTemplates).toEqual({});
  await f.tap('Мой режим');
  await f.tap('Удалить шаблон');
  await f.tap('Подтвердить');
  expect(JSON.parse(f.data().metadata.planner_preferences!).templates).toEqual(
    [],
  );
  expect(f.data().taskData).toEqual(before);
});

test('template confirmation is invalidated by home and rejects concurrent preference changes', async () => {
  const f = fixture(611);
  const open = async () => {
    await f.text(MENU.plan);
    await f.tap('Планировка');
    await f.tap('Шаблоны');
    await f.tap('Рабочий');
  };
  await open();
  const save = f.button('Сохранить шаблон');
  await f.tap('Меню');
  await f.click(save);
  expect(f.data().metadata.planner_preferences).toBeUndefined();
  await open();
  const concurrent = JSON.stringify({ start: '10:00', end: '20:00', busy: [] });
  f.data().metadata.planner_preferences = concurrent;
  await f.tap('Сохранить шаблон');
  expect(f.data().metadata.planner_preferences).toBe(concurrent);
});

test('external table editor exports CSV and previews pasted changes before saving', async () => {
  const f = fixture(612);
  await f.text(MENU.plan);
  await f.tap('Планировка');
  await f.tap('Шаблоны');
  await f.tap('Выходной');
  await f.tap('Редактор в таблице');
  await f.tap('Скачать CSV');
  expect(f.calls.some((call) => call.method === 'sendDocument')).toBe(true);
  await f.tap('Загрузить таблицу');
  await f.text(
    'Шаблон\tДни\tНачало\tКонец\tЗанятие\nВыходной\tСб|Вс\t08:00\t08:30\tЕда\nВыходной\tСб|Вс\t23:00\t07:00\tСон',
  );
  expect(f.data().metadata.planner_preferences).toBeUndefined();
  await f.tap('Сохранить все шаблоны');
  const saved = JSON.parse(f.data().metadata.planner_preferences!);
  expect(saved.templates[0].blocks[0].name).toBe('Еда');
  expect(saved.templates[0].blocks).toHaveLength(2);
});

test('invalid table input keeps the draft editable and home cancels import confirmation', async () => {
  const f = fixture(613);
  await f.text(MENU.plan);
  await f.tap('Планировка');
  await f.tap('Шаблоны');
  await f.tap('Выходной');
  await f.tap('Редактор в таблице');
  await f.tap('Загрузить таблицу');
  await f.text(
    'Шаблон,Дни,Начало,Конец,Занятие\nВыходной,Сб,08:00,09:00,Еда\nВыходной,Сб,08:30,10:00,Работа',
  );
  expect(
    f.calls.some((call) => String(call.text).includes('пересекаются')),
  ).toBe(true);
  await f.text(
    'Шаблон,Дни,Начало,Конец,Занятие\nВыходной,Сб,08:00,08:30,Завтрак',
  );
  const save = f.button('Сохранить все шаблоны');
  await f.tap('Меню');
  await f.click(save);
  expect(f.data().metadata.planner_preferences).toBeUndefined();
});

test('CSV documents produce drafts and cancellation suppresses late downloaded results', async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = '123:test';
  try {
    const f = fixture(614);
    const openImport = async () => {
      await f.text(MENU.plan);
      await f.tap('Планировка');
      await f.tap('Шаблоны');
      await f.tap('Выходной');
      await f.tap('Редактор в таблице');
      await f.tap('Загрузить таблицу');
    };
    const download = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'Шаблон,Дни,Начало,Конец,Занятие\nВыходной,Сб|Вс,08:00,08:30,Завтрак',
      ),
    );
    spies.push(download);
    await openImport();
    await f.document();
    expect(f.data().metadata.planner_preferences).toBeUndefined();
    await f.tap('Сохранить все шаблоны');
    expect(
      JSON.parse(f.data().metadata.planner_preferences!).templates[0].blocks[0]
        .name,
    ).toBe('Завтрак');
    const saved = f.data().metadata.planner_preferences;
    await openImport();
    let release!: (response: Response) => void;
    let began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    download.mockImplementation(
      Object.assign(
        async () => {
          began();
          return await new Promise<Response>((resolve) => {
            release = resolve;
          });
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    const pending = f.document();
    await started;
    await f.text(MENU.home);
    release(
      new Response(
        'Шаблон,Дни,Начало,Конец,Занятие\nВыходной,Сб|Вс,08:00,08:30,Поздняя правка',
      ),
    );
    await pending;
    expect(f.data().metadata.planner_preferences).toBe(saved);
    expect(f.labels()).toContain(MENU.all);
  } finally {
    if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = token;
  }
});
