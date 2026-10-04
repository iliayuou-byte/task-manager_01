import { afterEach, expect, spyOn, test } from 'bun:test';
import { Bot } from 'grammy';
import * as aiClient from '../clients/ai.js';
import type { Metadata, TaskData } from '../core/types.js';
import type { BotContext } from '../middlewares/session.js';
import { editSceneComposer } from '../scenes/editTaskScene.js';
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
    for (const call of [...calls].reverse()) {
      const markup = call.reply_markup as
        | {
            inline_keyboard?: Array<
              Array<{ text: string; callback_data: string }>
            >;
          }
        | undefined;
      const found = markup?.inline_keyboard
        ?.flat()
        .find((item) => item.text.includes(label));
      if (found) return found.callback_data;
    }
    throw new Error(`Button missing: ${label}`);
  };
  return { text, click, button, calls, data: () => data };
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
  expect(f.calls[f.calls.length - 1].text).toBe('Выбери час:');
  await f.click(f.button('Назад'));
  expect(String(f.calls[f.calls.length - 1].text)).toContain('Напоминания');
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
  expect(String(f.calls[f.calls.length - 1].text)).toContain('Первое');
  await f.click(f.button('Удалить'));
  await f.click(f.button('Назад'));
  expect(f.data().taskData.uncompleted).toHaveLength(2);
  expect(String(f.calls[f.calls.length - 1].text)).toContain('Первое');
  await f.click(f.button('Назад'));
  expect(String(f.calls[f.calls.length - 1].text)).toContain('Нажми на дело');
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
  expect(String(f.calls[f.calls.length - 1].text)).toContain('Напиши дела');
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
  expect(String(f.calls[f.calls.length - 1].text)).toContain('Выбери поле');
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
  expect(String(f.calls[f.calls.length - 1].text)).toContain('устарело');
});
