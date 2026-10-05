import { afterEach, expect, spyOn, test } from 'bun:test';
import { Bot } from 'grammy';
import * as aiClient from '../clients/ai.js';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { editSceneComposer } from '../scenes/editTaskScene.js';
import {
  getKeyboardAction,
  registerContextKeyboard,
} from '../services/contextKeyboard.js';
import { GitHubStorageProvider } from '../services/storage/GitHubStorageProvider.js';
import { MENU } from '../views/menuView.js';
import { registerAiSettings } from './aiSettings.js';
import { registerBrainActions } from './brain.js';
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
  registerMenu(bot);
  registerBrainActions(bot);
  registerSelectedRemoval(bot);
  bot.use(editSceneComposer);
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
      message: { ...message, text: value },
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
  return { text, click, button, labels, tap, calls, data: () => data };
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
  await f.click(f.button('Выключить автораспределение'));
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
  ).toContain('Нажми на дело');
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

test('main keyboard has only five sections; settings replaces it and back restores it', async () => {
  const f = fixture(512);
  await f.text(MENU.home);
  expect(f.labels()).toEqual([
    MENU.today,
    MENU.all,
    MENU.add,
    MENU.now,
    MENU.settings,
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
  await f.tap('Назад');
  expect(f.labels().some((label) => label.includes('1. Первое'))).toBe(true);
  await f.tap('1. Первое');
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
